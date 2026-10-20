const fs = require("fs")
if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            { type: "Label", key: "easyForts", md: 2 },
            { type: "Checkbox", key: "allowLvl60Easy", default: true },
            { type: "Checkbox", key: "allowLvl70Easy", default: true },
            { type: "Checkbox", key: "allowLvl80Easy", default: true },
            { type: "", md: 3 },

            { type: "Label", key: "hardForts", md: 2 },
            { type: "Checkbox", key: "allowLvl40Hard", default: false },
            { type: "Checkbox", key: "allowLvl50Hard", default: false },
            { type: "Checkbox", key: "allowLvl60Hard", default: false },
            { type: "Checkbox", key: "allowLvl70Hard", default: false },
            { type: "Checkbox", key: "allowLvl80Hard", default: false },

            { type: "Label", key: "other" },
            { type: "Checkbox", key: "buyCoins", default: false },
            { type: "Checkbox", key: "buyDecoration", default: false },
            { type: "Checkbox", key: "buyXP", default: false },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            { type: "Checkbox", key: "useCoin", default: false },
            { type: "Label", key: "ship Upgrades", md: 2 },
            { type: "Checkbox", key: "auto Upgrade Ships", default: false },
            { type: "Checkbox", key: "useTimeSkipsForShips", default: false },
            { type: "Text", key: "shipsMaxLevel", default: "10" },
            { type: "Text", key: "shipsKeepAquamarine", default: "0" },
        ]

    }
    try {
        fs.accessSync("./plugins-extra/upgradeStormCargo.js")
        module.exports.pluginOptions.push({
            type: "Checkbox",
            key: "upgradeStormForts"
        })
    }
    catch (e) {
        console.debug(e)
    }
    module.exports.pluginOptions.push({
        type: "Text",
        key: "commanderWhiteList"
    })
    return
}

const { getCommanderStats } = require("../../getEquipment.js")
const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, KingdomID } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank } = require("./attack.js")
const { movementEvents, waitForCommanderAvailable, commanderNumber, parseCommanderWhiteList, freeCommander, useCommander } = require("../commander.js")
const { sendXT, waitForResult, xtHandler, botConfig, events } = require("../../ggeBot.js")
const getAreaCached = require('../../getMap.js')
const err = require("../../err.json")
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const minTroopCount = 100

function spiralCoordinates(n) {
    if (n === 0) return { x: 0, y: 0 }

    const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2)
    const layerStart = (2 * (k - 1) + 1) ** 2
    const offset = n - layerStart
    const sideLength = 2 * k
    const side = Math.floor(offset / sideLength)
    const posInSide = offset % sideLength

    let x, y

    switch (side) {
        case 0:
            x = k
            y = -k + 1 + posInSide
            break
        case 1:
            x = k - 1 - posInSide
            y = k
            break
        case 2:
            x = -k
            y = k - 1 - posInSide
            break
        case 3:
            x = -k + 1 + posInSide
            y = -k
            break
    }

    return { x, y }
}

const pluginOptions =
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

if (pluginOptions.upgradeStormForts) {
    try {
        require("../../plugins-extra/upgradeStormCargo.js")
    }
    catch (e) {
        console.warn(e)
    }
}

//Cargo ("ship") upgrades; reads "auto Upgrade Ships" on every check
require("./stormCargoUpgrade.js")(pluginOptions)

const kingdomID = KingdomID.stormIslands
const type = AreaType.stormTower

events.once("load", async () => {
    let allowedLevels = [];

    if (pluginOptions["allowLvl40Hard"]) allowedLevels.push(10)
    if (pluginOptions["allowLvl50Hard"]) allowedLevels.push(11)
    if (pluginOptions["allowLvl60Hard"]) allowedLevels.push(12)
    if (pluginOptions["allowLvl70Hard"]) allowedLevels.push(13)
    if (pluginOptions["allowLvl80Hard"]) allowedLevels.push(14)

    if (pluginOptions["allowLvl60Easy"]) allowedLevels.push(7)
    if (pluginOptions["allowLvl70Easy"]) allowedLevels.push(8)
    if (pluginOptions["allowLvl80Easy"]) allowedLevels.push(9)

    if (allowedLevels.length === 0) allowedLevels = [7, 8, 9, 13, 14]

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => e.type == AreaType.externalKingdom);

    xtHandler.on("dcl", obj => {
        const castleProd = Types.DetailedCastleList(obj)
            .castles.find(a => a.kingdomID == kingdomID)
            .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

        if (pluginOptions["buyCoins"]) {
            if (castleProd.aqua > 500000) {
                castleProd.aqua -= 500000
                sendXT("sbp", JSON.stringify({ "PID": 2798, "BT": 3, "TID": -1, "AMT": 1, "KID": 4, "AID": -1, "PC2": -1, "BA": 0, "PWR": 0, "_PO": -1 }))
                console.info("broughtCoins")
            }
        }
        if (pluginOptions["buyDecoration"]) {
            if (castleProd.aqua > 500000) {
                castleProd.aqua -= 500000
                sendXT("sbp", JSON.stringify({ "PID": 3117, "BT": 3, "TID": -1, "AMT": 1, "KID": 4, "AID": -1, "PC2": -1, "BA": 0, "PWR": 0, "_PO": -1 }))
                console.info("broughtDeco")
            }
        }
        if (pluginOptions["buyXP"]) {
            for (let i = 0; i < Math.floor(castleProd.aqua / 10000); i++) {
                castleProd.aqua -= 10000
                sendXT("sbp", JSON.stringify({ "PID": 3114, "BT": 3, "TID": -1, "AMT": 1, "KID": 4, "AID": -1, "PC2": -1, "BA": 0, "PWR": 0, "_PO": -1 }))
                console.info("broughtXP")
            }
        }
    })
    if (pluginOptions["easyfortsonly"])
        allowedLevels = [9, 8, 7]

    if (pluginOptions["addworserforts"])
        allowedLevels.push(11, 10)

    let sortedAreaInfo = []
    const movements = []

    xtHandler.on("gam", obj => {
        const movementsGAA = Types.GetAllMovements(obj)
        movementsGAA?.movements.forEach(movement => {
            if (kingdomID != movement.movementData.kingdomID)
                return

            const targetAttack = movement.movementData.targetAttack

            if (type != targetAttack.type)
                return

            if (movements.find(e => e.x == targetAttack.x && e.y == targetAttack.y))
                return

            movements.push(targetAttack)
        })
    })
    xtHandler.on("cat", obj => {
        const movementInfo = Types.ReturningAttack(obj)
        const sourceAttack = movementInfo.movement.movementData.sourceAttack
        if (kingdomID != movementInfo.movement.movementData.kingdomID ||
            type != sourceAttack.type)
            return

        let index = movements.findIndex(e => e.x == sourceAttack.x && e.y == sourceAttack.y)
        if (index == -1)
            return
        movements.splice(index, 1)
    })
    //Gotta detect cooling down towers
    const sendHit = async () => {
        const comList = parseCommanderWhiteList(pluginOptions.commanderWhiteList)

        const commander = await waitForCommanderAvailable(comList, undefined,
            (a, b) => getCommanderStats(b).relicLootBonus - getCommanderStats(a).relicLootBonus)

        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < sortedAreaInfo.length; i++) {
                    const areaInfo = sortedAreaInfo[i]

                    if (movements.find(e => e.x == areaInfo.x && e.y == areaInfo.y))
                        continue

                    let time = (areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000) - timeSinceEpoch
                    if (time > 0)
                        continue

                    await ClientCommands.preSpyInfo(areaInfo.x, areaInfo.y, kingdomID)()

                    if (!allowedLevels.includes(areaInfo.extraData[2]))
                        continue

                    if ((areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000) - Date.now() > 0)
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                let AI = sortedAreaInfo[index]

                let toLevel = {
                    7: 60,
                    8: 70,
                    9: 80,
                    10: 40,
                    11: 50,
                    12: 60,
                    13: 70,
                    14: 80,
                }
                const level = toLevel[AI.extraData[2]]

                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, undefined, pluginOptions)

                attackInfo.LP = 3

                const attackerMeleeTroops = []
                const attackerRangeTroops = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if (unitInfo.fightType == 0) {
                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, unit.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, unit.ammount])
                    }
                }

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e[1])
                attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"

                attackInfo.A.forEach((wave, i) => {
                    if (i > 4)
                        return
                    const commanderStats = getCommanderStats(commander)
                    const maxTroopFlank = Math.floor(getAmountSoldiersFlank(level) * (1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100)) - 1

                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    maxTroops = maxTroopFlank
                    wave.R.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                })

                sendXT("cra", JSON.stringify(attackInfo))

                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })
                if (r == 0)
                    movements.push(AI)

                return { ...obj, result: r }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]

            console.info("hittingTargetAttack", 'C', commanderNumber(attackInfo.AAM.UM.L.ID), ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(movementInfo) {
                        if (movementInfo.movement.movementData.kingdomID != kingdomID)
                            return
                        if (movementInfo.movement.movementData.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                    return true
                default:
                    throw e
            }
        }
    }
    done:
    for (let i = 0, j = 0; i < 13 * 13; i++) {
        let rX, rY
        let rect
        do {

            ({ x: rX, y: rY } = spiralCoordinates(j++))
            rX *= 100
            rY *= 100

            rect = {
                x: sourceCastleArea.x + rX - 50,
                y: sourceCastleArea.y + rY - 50,
                w: sourceCastleArea.x + rX + 50,
                h: sourceCastleArea.y + rY + 50
            }
            if (j > Math.pow(13 * 13, 2))
                break done
        } while ((sourceCastleArea.x + rX) <= -50 || (sourceCastleArea.y + rY) <= -50 || (sourceCastleArea.x + rX) >= (1286 + 50) || (sourceCastleArea.y + rY) >= (1286 + 50))
        rect.x = rect.x < 0 ? 0 : rect.x
        rect.y = rect.y < 0 ? 0 : rect.y
        rect.w = rect.w < 0 ? 0 : rect.w
        rect.h = rect.h < 0 ? 0 : rect.h
        rect.x = rect.x > 1286 ? 1286 : rect.x
        rect.y = rect.y > 1286 ? 1286 : rect.y
        rect.w = rect.w > 1286 ? 1286 : rect.w
        rect.h = rect.h > 1286 ? 1286 : rect.h
        let gaa
        let attemptsLeft = 5
        do {
            try {
                gaa = await getAreaCached(kingdomID, rect.x, rect.y, rect.w, rect.h)
            }
            catch { attemptsLeft-- }
            if (attemptsLeft <= 0)
                continue done
        } while (!gaa)

        let areaInfo = gaa.areaInfo.filter(ai => ai.type == type).sort((a, b) =>
            (Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2)) -
            (Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2)))

        sortedAreaInfo.push(...areaInfo)

        if (sortedAreaInfo.every(ai => ![7, 8, 9].includes(ai.extraData[2]))) //Find and hit a good one before continuing scanning
            continue

        sortedAreaInfo.sort((a, b) => {
            if ((a.extraData[2] % 10) > (b.extraData[2] % 10))
                return -1
            if ((a.extraData[2] % 10) < (b.extraData[2] % 10))
                return 1
            //hits left
            if (a.extraData[4] < b.extraData[4])
                return -1
            if (a.extraData[4] > b.extraData[4])
                return 1

            return 0
        })
        while (await sendHit());
    }

    while (true) {
        let minimumTimeTillHit = Infinity

        for (let i = 0; i < sortedAreaInfo.length; i++) {
            const areaInfo = sortedAreaInfo[i]

            if (!allowedLevels.includes(areaInfo.extraData[2]))
                if (((areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000) - Date.now()) <= 0)
                    continue

            if (!movements.find(movement => movement.x == areaInfo.x && movement.y == areaInfo.y))
                minimumTimeTillHit = Math.min(minimumTimeTillHit, (areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000))
        }

        let time = (Math.max(0, minimumTimeTillHit - Date.now()))
        console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
        await new Promise(r => setTimeout(r, time).unref())

        while (await sendHit());
    }
})