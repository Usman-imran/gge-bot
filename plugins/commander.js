if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { xtHandler, playerInfo, waitForResult } = require('../ggeBot.js')
const { Types } = require('../protocols.js')
const EventEmitter = require('node:events')

const event = new EventTarget()

let commanders = []
let usedCommanders = [] 

function freeCommander(LID) {
    if (LID == undefined)
        return
    let index = usedCommanders.findIndex(e => e == LID)
    if (index == -1)
        return

    usedCommanders.splice(index, 1)
    event.dispatchEvent(new CustomEvent('freedCommander', { detail: LID }))
}
function useCommander(LID) {
    if (LID != undefined && !usedCommanders.includes(LID))
        usedCommanders.push(LID)
    return LID
}

//The game numbers commanders ("Commander 5") by sorting them by ID
const commanderNumber = lordID => {
    const index = commanders.map(e => Number(e.ID)).sort((a, b) => a - b).indexOf(Number(lordID))
    return index == -1 ? undefined : index + 1
}

//Commander Whitelist text -> game commander numbers.
//"" = all commanders (undefined), "3", "1-5", "1,3,5" and "1-3, 7" are read.
//Text that can't be read gives an empty list: no commander is used, so
//commanders kept for manual play are never sent by mistake.
const reportedWhiteLists = new Set()
const parseCommanderWhiteList = text => {
    text = String(text ?? "").trim()
    if (text == "" || text == "0")
        return undefined

    const numbers = []
    for (const part of text.split(",").map(e => e.trim()).filter(e => e != "")) {
        const range = part.match(/^(\d+)\s*-\s*(\d+)$/)
        if (range) {
            const [start, end] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b)
            for (let i = start; i <= end; i++)
                numbers.push(i)
        }
        else if (/^\d+$/.test(part))
            numbers.push(Number(part))
        else {
            if (!reportedWhiteLists.has(text)) {
                reportedWhiteLists.add(text)
                console.warn(`Commander Whitelist "${text}" can't be read, no commander will be sent. Use e.g. 1-5, 3 or 1,3,5.`)
            }
            return []
        }
    }
    return numbers
}

const waitForCommanderAvailable = async (arr, filterCallback, sortCallback) => {
    if(commanders.length == 0) {
        parseGLI((await waitForResult("gli", 1000 * 10))[0].C)
    }
    //arr: allowed game commander numbers, see parseCommanderWhiteList
    let usableCommanders = commanders.map(e => new Types.Lord(e))
        .filter(e => ((!arr || arr.includes(commanderNumber(e.lordID))) &&
            !usedCommanders.includes(e.lordID)))

    if (sortCallback)
        usableCommanders.sort(sortCallback)
    if (filterCallback)
        usableCommanders = usableCommanders.filter(filterCallback)

    let LID = usableCommanders[0]?.lordID

    LID ??= await new Promise(resolve => {
        //Keeps waiting until a commander this caller may use comes back.
        //Only a taken commander stops the event, so other waiting plugins
        //still get the ones that are not on this caller's list.
        const checkForCommander = currentEvent => {
            if(usedCommanders.find(e => e == currentEvent.detail))
                return
            const com = commanders.find(e => e.ID == currentEvent.detail)
            if (!com)
                return
            if ((!arr || arr.includes(commanderNumber(com.ID)))
                && (!filterCallback || filterCallback(new Types.Lord(com)))) {
                currentEvent.stopImmediatePropagation()
                event.removeEventListener("freedCommander", checkForCommander)
                resolve(currentEvent.detail)
            }
        }
        event.addEventListener("freedCommander", checkForCommander)
    })

    useCommander(LID)
    return new Types.Lord(commanders.find(e => e.ID == LID))
}

let parseGLI = e => commanders = e

xtHandler.on("aci", (obj, r) => !r ? parseGLI(obj.gli.C) : void 0)
xtHandler.on("adi", (obj, r) => !r ? parseGLI(obj.gli.C) : void 0)
xtHandler.on("gli", (obj, r) => !r ? parseGLI(obj.C) : void 0)

xtHandler.on("cat", obj => {
    if (obj.A.M.OID != playerInfo.playerID)
        return

    useCommander(obj?.A?.UM?.L?.ID)

    setTimeout(() => freeCommander(obj?.A?.UM?.L?.ID),
        (obj.A.M.TT - obj.A.M.PT + 1) * 1000).unref()
})
xtHandler.on("gam", async obj => {
    if (playerInfo.playerID == NaN) {
        playerInfo.playerID = await new Promise(resolve => {
            xtHandler.once("gpi", obj => resolve(Number(obj.PID)))
        })
    }
    for (let i = 0; i < obj.M.length; i++) {
        const o = obj.M[i]
        try {
            if (o.M.OID != playerInfo.playerID)
                continue
            
            let lordID = o?.UM?.L?.ID
            if (lordID == undefined)
                continue

            if (usedCommanders.includes(lordID))
                continue

            useCommander(lordID)

            if(o.M.TA[4] == playerInfo.playerID) {
                setTimeout(() => freeCommander(lordID),
                (o.M.TT - o.M.PT + 1) * 1000).unref()
            }
        }
        catch (e) {
            console.warn(e)
        }
    }
})

const movementEvents = new EventEmitter()

xtHandler.on("cat", obj => {
    const movementInfo = Types.ReturningAttack(obj)

    setTimeout(() =>
        movementEvents.emit("return", movementInfo),

        movementInfo.movement.movementData.totalTime -
        (movementInfo.movement.movementData.deltaTime -
        Date.now()))
})

module.exports = {
    movementEvents,
    waitForCommanderAvailable,
    commanderNumber,
    parseCommanderWhiteList,
    useCommander,
    freeCommander
}