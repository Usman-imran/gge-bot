const { isMainThread, workerData, parentPort } = require('node:worker_threads')
if (isMainThread)
    return

process.on('uncaughtException', console.error) //Wanna cry? Remove this.

const EventEmitter = require('node:events')
const WebSocket = require('ws')
const { DatabaseSync } = require('node:sqlite')
const { getCallSites } = require('node:util')
const { I18n } = require('i18n')
const path = require('node:path')
const ggeConfig = require("./ggeConfig.json")
const ActionType = require('./actions.json')
const err = require('./err.json')
const events = new EventEmitter()

const i18n = new I18n({
  locales: ['en', 'de', 'ar', 'fi', 'he', 'hu', 'pl', 'ro', 'tr', 'cs'],
  directory: path.join(__dirname, 'website', 'public', 'locales'),
  updateFiles: false,
})

const botConfig = workerData

const _console = console

function mngLog(logLevel, msg) {
    let callSites = getCallSites(6)
    let scriptName = path.basename(callSites[2]?.scriptName).slice(0, -3)
    // let plugin = botConfig.plugins[scriptName]
    // let name = plugin?.name ?? scriptName

    const now = new Date()
    let hours = now.getHours()
    let minutes = now.getMinutes()

    hours = hours < 10 ? '0' + hours : hours
    minutes = minutes < 10 ? '0' + minutes : minutes

    let message = [`[${hours + ':' + minutes}] `, '[', `${scriptName}`, '] ']

    message.push(...msg)

    message = message.map(msg => {
        if(msg instanceof Error)
            return msg.message

        return msg
    })

    _console.log(`[${botConfig.name}] ${message.map(i18n.__).join('')}`)
    parentPort.postMessage([ActionType.GetLogs, logLevel, message])
}
if (!botConfig.internalWorker) {
    console = {}
    console.log = (...msg) => mngLog(0, msg)
    console.info = (...msg) => mngLog(0, msg)
    console.warn = (...msg) => mngLog(1, msg)
    console.error = (...msg) => mngLog(2, msg)
    console.debug = ggeConfig.debug ? _console.debug : _ => { }
    console.trace = _console.trace
}

const xtHandler = new EventEmitter()

const rawProtocolSeparator = "%"
function sendXT(cmdName, paramObj) {
    try {
    console.debug(cmdName, JSON.parse(paramObj))
    } catch {}
    webSocket.send(rawProtocolSeparator + ["xt", botConfig.gameServer, cmdName, 1].join(rawProtocolSeparator) + rawProtocolSeparator + paramObj + rawProtocolSeparator)
}

let lordErrors = 0
let tooManyUnits = 0

// "<key>TIMED_OUT" is also printed for every successful response of these keys,
// which floods the log; hide exactly those lines. The promises still resolve
// and reject normally, and real error codes are still logged.
const quietTimeoutKeys = new Set(["gaa", "dcl", "cra"])
// Keys whose callers log every outcome themselves, never log these here.
const quietResultKeys = new Set()
const warnWaitForResult = (key, msg) => {
    if (msg == "TIMED_OUT" && quietTimeoutKeys.has(key))
        return
    if (quietResultKeys.has(key))
        return
    console.warn(key, msg)
}

/**
 * 
 * @param {string} key 
 * @param {number} timeout 
 * @param {function(object,number)} func 
 * @returns {Promise<[obj: object, result: Number]>}
 */
const waitForResult = (key, timeout, func) => new Promise((resolve, reject) => {
    if (timeout == undefined)
        reject(`waitForResult: No timeout specified`)

    timeout *= 2.5
    func ??= _ => true

    let timer
    let result
    const checkForLordIssues = () => {
        if (err[result] == "LORD_IS_USED")
            lordErrors++
        if (err[result] == "ATTACK_TOO_MANY_UNITS")
            tooManyUnits++
        if (lordErrors == 5) {
            console.error("closedReason", "LORD_IS_USED")
            parentPort.postMessage([ActionType.KillBot])
            return
        }
        if (tooManyUnits == 12) {
            console.error("closedReason", "ATTACK_TOO_MANY_UNITS")
            parentPort.postMessage([ActionType.KillBot])
            return
        }
        if (err[result] == "MOVEMENT_HAS_NO_UNITS") {
            console.error("closedReason", "MOVEMENT_HAS_NO_UNITS")
            parentPort.postMessage([ActionType.KillBot])
            return
        }
        if (err[result] == "CANT_START_NEW_ARMIES") {
            console.error("closedReason", "CANT_START_NEW_ARMIES")
            parentPort.postMessage([ActionType.KillBot])
            return
        }
    }

    if (timeout > 0) {
        timer = setTimeout(() => {
            xtHandler.removeListener(key, helperFunction)
            const msg = (result == undefined || result == 0) ? "TIMED_OUT" : !err[result] ? result : err[result]
            result = -1
            // console.debug(key, "timedOut")

            warnWaitForResult(key, msg)

            reject(msg)
        }, timeout * (ggeConfig.timeoutMultiplier ?? 1))
    }

    const helperFunction = (data, _result) => {
        if (result != 0)
            result = _result

        const msg = (_result == undefined || _result == 0) ? "TIMED_OUT" : !err[_result] ? _result : err[_result]
        warnWaitForResult(key, msg)
        
        checkForLordIssues()
        if (!func(Object(data), Number(_result)))
            return

        xtHandler.removeListener(key, helperFunction)
        clearInterval(timer)
        resolve([Object(data), Number(_result)])
    }

    xtHandler.addListener(key, helperFunction)
})

const webSocket = new WebSocket(`wss://${botConfig.gameURL}/`);

const playerInfo = {
    level: NaN,
    userID: NaN,
    playerID: NaN,
    email: String(),
    acceptedTOS: Boolean(),
    verifiedEmail: Boolean(),
    isCheater: Boolean(),
    name: String(),
    alliance: {
        id: Number(),
        rank: Number(),
        name: String(),
        fame: Number(),
        searchingForPlayers: Boolean()
    }
}

module.exports = {
    sendXT,
    xtHandler,
    waitForResult,
    webSocket,
    events,
    botConfig,
    playerInfo,
    quietTimeoutKeys,
    quietResultKeys
}

let status = {}
events.once("load", async (_, r) => {
    const { getResourceCastleList, AreaType, KingdomID, Types } = require('./protocols.js')
    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == KingdomID.stormIslands)?.areaInfo.find(e => e.type == AreaType.externalKingdom);

    sendXT("dcl", JSON.stringify({ CD: 1 }))
    setInterval(() =>
        sendXT("dcl", JSON.stringify({ CD: 1 })),
        1000 * 60 * 5)
    if (sourceCastleArea) {
        xtHandler.on("dcl", obj => {
            const castleProd = Types.DetailedCastleList(obj)
                .castles.find(a => a.kingdomID == KingdomID.stormIslands)?.areaInfo[0]

            if (!castleProd)
                return

            Object.assign(status, {
                aquamarine: castleProd.aqua != 0 ? Math.floor(castleProd.aqua) : undefined,
                food: castleProd.food != 0 ? Math.floor(castleProd.food) : undefined,
                mead: Math.floor(castleProd.mead != 0 ? Math.floor(castleProd.mead) : undefined)
            })
            parentPort.postMessage([ActionType.StatusUser, status])
        })
    }
})

events.on("configModified", () => {
    console.log("botConfigReloaded")
})

webSocket.onopen = _ => webSocket.send('<msg t="sys"><body action="verChk" r="0"><ver v="166"/></body></msg>')

xtHandler.on("gal", obj => {
    playerInfo.alliance.id = Number(obj.AID)
    playerInfo.alliance.rank = Number(obj.R)
    playerInfo.alliance.name = String(obj.N)
    playerInfo.alliance.fame = Number(obj.ACF)
    playerInfo.alliance.searchingForPlayers = Boolean(obj.SA)
})

xtHandler.on("gxp", obj => {
    playerInfo.level = obj.LVL + obj.LL

    if (!botConfig.externalEvent)
        return

    Object.assign(status, {
        level: playerInfo.level
    })
    parentPort.postMessage([ActionType.StatusUser, status])

})
xtHandler.on("gpi", obj => {
    playerInfo.userID = Number(obj.UID)
    playerInfo.playerID = Number(obj.PID)
    playerInfo.name = String(obj.PN)
    playerInfo.email = String(obj.E)
    playerInfo.verifiedEmail = Boolean(obj.V)
    playerInfo.acceptedTOS = Boolean(obj.CTAC)
    playerInfo.isCheater = Boolean(obj.CL)
})

let errorCount = 0
let sentHits = 0

xtHandler.on("cra", (obj, r) => r == 0 ? sentHits++ : void 0)

webSocket.onmessage = e => {
    let message = e.data.toString()
    if (message.charAt(0) == rawProtocolSeparator) {
        let params = message.substr(1, message.length - 2).split(rawProtocolSeparator)
        let data = params.splice(1, params.length - 1)

        switch (data[0]) {
            case "gbd":
                for (const [key, value] of Object.entries(JSON.parse(data[3])))
                    xtHandler.emit(key, value, Number(data[2]))
                break
            case "vck":
                xtHandler.emit(data[0], data[3], Number(data[2]));
                break
            case "gfl":
                xtHandler.emit(data[0], data[3], Number(data[2]));
                break
            default:
                if (data[2] != 0 && !(data[0] == "lli" && data[2] == 453)) {
                    console.debug(err[data[2]] ?? data[2], data[0])
                    errorCount++
                }
            case "core_pol":
            case "rlu":
                if (xtHandler.listenerCount(data[0]) == 0)
                    return
                try {
                    data[3] = JSON.parse(data[3])
                }
                catch {}
                xtHandler.emit(data[0], data[3], Number(data[2]))
        }
    }

    else if (message.charAt(0) == "<") {
        switch (message) {
            case "<msg t='sys'><body action='apiOK' r='0'></body></msg>":
                webSocket.send(`<msg t="sys"><body action="login" r="0"><login z="${botConfig.gameServer}"><nick><![CDATA[]]></nick><pword><![CDATA[undefined%en%0]]></pword></login></body></msg>`)
                break
            case "<msg t='sys'><body action='joinOK' r='1'><pid id='0'/><vars /><uLs r='1'></uLs></body></msg>":
                webSocket.send('<msg t="sys"><body action="roundTrip" r="1"></body></msg>')
                sendXT("vck", `undefined%web-html5%<RoundHouseKick>%${(Math.random() * Number.MAX_VALUE).toFixed()}`)
                break
            case "<msg t='sys'><body action='roundTripRes' r='1'></body></msg>":
                break
        }
    }
}
webSocket.onerror = () => {
    events.emit("unload");
    process.exit(0) }
webSocket.onclose = () => {
    events.emit("unload");
    process.exit(0)
}

events.on("unload", () => {
    console.debug("errorCount", errorCount)
    console.debug("hitCount", sentHits)
})

parentPort.on("message", async obj => {
    switch (obj[0]) {
        case ActionType.SetPluginOptions:
            function deepCopy(old_, new_) {
                Object.keys(new_).forEach(key => {
                    if (typeof new_[key] === 'object' && !Array.isArray(new_[key]) && new_[key] !== null)
                        deepCopy(old_[key], new_[key])
                    else
                        old_[key] = new_[key];
                });
            }
            deepCopy(botConfig, obj[1])
            events.emit("configModified")
            break
            break
        case ActionType.StatusUser:
            parentPort.postMessage([ActionType.StatusUser, status])
            break
        case ActionType.GetExternalEvent:
            sendXT("sei", JSON.stringify({}))
            let [sei, _] = await waitForResult("sei", 1000 * 10)
            if (sei.E.find(e => e.EID == 113))
                sendXT("glt", JSON.stringify({ GST: 3 }))
            else
                sendXT("glt", JSON.stringify({ GST: 2 }))
            let [glt, _2] = await waitForResult("glt", 1000 * 10)
            parentPort.postMessage([ActionType.GetExternalEvent, { sei: sei, glt: glt }])
            break

    }
})

let retry = async () => {
    if (botConfig.externalEvent) {
        sendXT("tlep", JSON.stringify({ TLT: botConfig.tempServerData.glt.TLT }))
        let [obj, result] = await waitForResult("tlep", 1000 * 10)

        if (result == 453) {
            console.log("retryLogin", obj.CD, "retryLoginSeconds")
            setTimeout(retry, obj.CD * 1000)
            return
        }

        if (err[result] == "IS_BANNED") {
            console.log("retryLogin", (obj.RS / 60 / 60).toFixed(2), "retryLoginHours")
            setTimeout(retry, obj.RS * 1000)
            return
        }

        return
    }
    if (botConfig.lt) {
        sendXT("lli", JSON.stringify({
            "CONM": 350,
            "RTM": 57,
            "ID": 0,
            "PL": 1,
            "NOM": botConfig.name,
            "LT": botConfig.lt,
            "LANG": "en",
            "DID": "0",
            "AID": "17254677223212351",
            "KID": "",
            "REF": "https://empire.goodgamestudios.com",
            "GCI": "",
            "SID": 9,
            "PLFID": 1
        }))
    }
    else {
        sendXT("lli", JSON.stringify({
            CONM: 212,
            RTM: 25,
            ID: 0,
            PL: 1,
            NOM: botConfig.name,
            PW: botConfig.pass,
            LT: null,
            LANG: "en",
            DID: "0",
            AID: "1745592024940879420",
            KID: "",
            REF: "https://empire.goodgamestudios.com",
            GCI: "",
            SID: 9,
            PLFID: 1
        }))
    }
}
xtHandler.on("vck", _ => retry())

xtHandler.on("rlu", _ => webSocket.send('<msg t="sys"><body action="autoJoin" r="-1"></body></msg>'))
let loginAttempts = 0
xtHandler.on("lli", async (obj, r) => {
    if (r == 453) {
        console.log("retryLogin", obj.CD, "retryLoginSeconds")
        setTimeout(retry, obj.CD * 1000)
        return
    }

    if (err[r] == "IS_BANNED") {
        console.log("retryLogin", obj.CD, "retryLoginSeconds")
        console.log("retryLogin", (obj.RS / 60 / 60).toFixed(2), "retryLoginHours")
        setTimeout(retry, obj.RS * 1000)
        return
    }

    if (r == 0) {
        //Due to exploits that can break the client this is to give limited access again.
        const timer = setTimeout(() => {
            console.warn("loggedIn", "loggedInWithoutEventData")
            console.warn("featuresMightNotWork")
            events.emit("load")
        }, 30 * 1000 * (ggeConfig.timeoutMultiplier ?? 1))

        xtHandler.once("sei", () => {
            parentPort.postMessage([ActionType.Started])
            console.log("loggedIn")
            events.emit("load")
            clearTimeout(timer)
        })
        events.emit("earlyLoad")
        setInterval(() => sendXT("pin", "<RoundHouseKick>"), 1000 * 60).unref()
        return
    }

    if (r == err["INVALID_LOGIN_TOKEN"]) {
        loginAttempts++
        if (loginAttempts < 30)
            return retry()
    }
    if (botConfig.internalWorker)
        process.exit(0)

    status.hasError = true
    parentPort.postMessage([ActionType.StatusUser, status])
    parentPort.postMessage([ActionType.KillBot])
})

xtHandler.on("sne", obj => {
    obj.MSG.forEach(message => {
        if (message[1] != 67)
            return
        sendXT("dms", JSON.stringify({ MID: message[0] }))
    });
})

xtHandler.on("qli", obj => obj.QL.forEach(quest => {
    if ([3000, 3002, 3019, 3490].includes(quest.QID))
        sendXT("qsc", JSON.stringify({ QID: quest.QID }))
}))

xtHandler.on("gcu", obj => {
    Object.assign(status, {
        coin: obj.C1 != 0 ? Math.floor(playerInfo.coin = obj.C1) : undefined,
        rubies: obj.C2 != 0 ? Math.floor(playerInfo.rubies = obj.C2) : undefined,
    })
    parentPort.postMessage([ActionType.StatusUser, status])
})

events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != 117)
        return
    if (eventInfo.FTDC != 1)
        return
    if (playerInfo.rubies == undefined)
        debugger

    if (playerInfo.rubies < 100)
        return

    console.log("grabbedFortuneTellerFortune")
    sendXT("ftl", JSON.stringify({}))
})

xtHandler.on("gcs", obj => {
    obj.CHR.forEach(offering => {
        for (let i = 0; i < offering.FOA; i++) {
            if (offering.CID == 1) {
                console.log("GrabbedOffering", "grabbedLudwig")
                sendXT("sct", JSON.stringify({ CID: 1, OID: 6001, IF: 1, AMT: 1 }))
            }
            if (offering.CID == 2) {
                console.log("GrabbedOffering", "grabbedKnight")
                sendXT("sct", JSON.stringify({ CID: 2, OID: 6002, IF: 1, AMT: 1 }))
            }
            if (offering.CID == 3) {
                console.log("GrabbedOffering", "grabbedBeatrice")
                sendXT("sct", JSON.stringify({ CID: 3, OID: 6003, IF: 1, AMT: 1 }))
            }
        }
    })
})

require("./protocols.js")
try {
    if (botConfig.externalEvent)
        require("./plugins-extra/externalEventHelper.js")
} catch {}

for (const [_, val] of Object.entries(botConfig.plugins)) {
    if (!val.state)
        continue
    try {
        require(`./${val.filename}`)
    }
    catch (e) {
        console.warn(e)
    }
}