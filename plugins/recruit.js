if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                //A Select can only hold one value, so only one troop type can be active at a time
                type: "Select",
                key: "recruitTroopType",
                selection: [
                    "Range Defender (Valkyrie sniper)",
                    "Melee Defender (Protector of the north)",
                    "Range Attacker (Valkyrie ranger)",
                    "Melee Attacker (Shield-maiden)"
                ],
                default: 0
            },
            {
                //A slot holds 110 units (TUA in the spl answer)
                type: "Text",
                key: "recruitPackageSize",
                default: "110"
            },
            {
                //Clicks "Alliance help" in the recruit window after recruiting
                type: "Checkbox",
                key: "recruitAllianceHelp",
                default: true
            }
        ]
    }
    return
}

const path = require('node:path')
const { events, botConfig, sendXT, waitForResult, quietResultKeys, playerInfo } = require("../ggeBot.js")
const { ClientCommands, KingdomID } = require("../protocols.js")
const { visitCastles } = require("../castleVisit.js")
const unitsData = require("../items/units.json")
const err = require("../err.json")

const pluginName = path.basename(__filename).slice(0, -3)

//Every cycle tries to fill all free queue slots of every barracks.
//A full queue costs one refused request per castle and is not logged.
const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 4

//The client sends C2S_BUY_UNIT_PACKAGE ("bup") when Recruit is clicked
//(CastleRecruitSelectedUnitComponent.onRecruitmentClick -> C2SBuyUnitPackageVO)
const RECRUIT_COMMAND = "bup"

//Package list of soldiers (UnitProductionConst.UNIT_LIST), confirmed from a
//captured manual recruit: the client sends LID 0 and the server echoes it in spl.
const UNIT_LIST_ID = 0

//Safety net for filling the queue: the server ends it with
//NO_FREE_CONSTRUCTION_SLOT long before this.
const MAX_PACKAGES_PER_CASTLE = 20

//The order here matches the selection order above
const TROOP_TYPES = [
    { unitType: "MeadBow", name: "Valkyrie sniper" },
    { unitType: "MeadMace", name: "Protector of the north" },
    { unitType: "MeadRanger", name: "Valkyrie ranger" },
    { unitType: "MeadShieldMaiden", name: "Shield-maiden" }
]

//Main castle + all 3 outposts live in the Great Empire.
//Ice, Sand and Fire are the other kingdoms that can hold a barracks.
const RECRUIT_KINGDOMS = [
    KingdomID.greatEmpire,
    KingdomID.burningSands,
    KingdomID.everWinterGlacier,
    KingdomID.firePeaks
]

const getOptions = () => {
    const opts = botConfig.plugins[pluginName] ?? {}

    const rawIndex = Number(opts.recruitTroopType)
    const troopIndex = Number.isFinite(rawIndex) ?
        Math.min(TROOP_TYPES.length - 1, Math.max(0, Math.floor(rawIndex))) : 0

    return {
        troop: TROOP_TYPES[troopIndex],
        packageSize: Math.min(100000, Math.max(1, Number(opts.recruitPackageSize) || 110)),
        allianceHelp: opts.recruitAllianceHelp ?? true
    }
}

//Every level of the unit family, cheapest/lowest first.
//Level 0 is always recruitable, everything above sits behind research.
const levelChains = {}
const getLevelChain = unitType => levelChains[unitType] ??= unitsData
    .filter(unit => unit.type == unitType && unit.name == "Barracks")
    .map(unit => ({
        wodID: Number(unit.wodID),
        level: Number(unit.level ?? 0),
        buildingLevel: Number(unit.buildingLevel ?? 0),
        costCoins: Number(unit.costC1 ?? 0)
    }))
    .sort((a, b) => a.level - b.level)

const errorIs = (result, ...names) => names.includes(err[result])

//The unit level itself is not available here (research missing, or the
//castle's barracks is not high enough for this level). Lower levels may still
//work, so step down.
const isLevelLockedError = result =>
    errorIs(result, "LOCKED", "INVALID_WOD_ID", "MISSING_REQUIRED_BUILDING")

//The normal "nothing to do" answer: every slot of this barracks is in use.
const isQueueFullError = result => errorIs(result, "NO_FREE_CONSTRUCTION_SLOT")

//Castles already reported as missing the barracks level, so the warning
//shows up once per session instead of every cycle.
const reportedMissingBuilding = new Set()

//Exactly what the client sends when you click "Recruit":
//  new C2SBuyUnitPackageVO(listId, wodId, amount, activeKingdomID, areaId)
//LID = production list of the barracks category, WID = unit, AMT = amount,
//SID = kingdom, AID = area, PO = -1 (first free slot), PWR = 0 (no premium
//speedup), SK = 73 (the client's default).
const sendRecruit = async (castle, unit, amount) => {
    sendXT(RECRUIT_COMMAND, JSON.stringify({
        LID: UNIT_LIST_ID,
        WID: unit.wodID,
        AMT: amount,
        SID: castle.kingdomID,
        AID: castle.areaID,
        PO: -1,
        PWR: 0,
        SK: 73
    }))

    //Rejects (locked level, full queue, ...) resolve with a non zero result,
    //only a missing answer rejects. waitForResult stretches this by 2.5x.
    const [_, result] = await waitForResult(RECRUIT_COMMAND, 1000 * 4)
    return Number(result)
}

//Every outcome of our command is logged by this plugin
quietResultKeys.add(RECRUIT_COMMAND)

//The "Alliance help" button of the recruit window sends
//C2SAllianceHelpRequestVO(listId, AllianceConst.ALLIANCE_HELP_RECRUITMENT_LIST).
//The type was confirmed from a captured manual request: the server's "ahh"
//answer carries TID 6 and OP.RLID 0. The server checks the castle we are in.
const ALLIANCE_HELP_COMMAND = "ahr"
const ALLIANCE_HELP_RECRUITMENT_LIST = 6
quietResultKeys.add(ALLIANCE_HELP_COMMAND)

//Not in an alliance: nothing to ask until the next session
let noAlliance = false
//Failures already logged, once per castle and reason
const reportedHelpErrors = new Set()

const requestAllianceHelp = async castle => {
    if (noAlliance)
        return

    sendXT(ALLIANCE_HELP_COMMAND, JSON.stringify({
        ID: UNIT_LIST_ID,
        T: ALLIANCE_HELP_RECRUITMENT_LIST
    }))

    let result
    try {
        [, result] = await waitForResult(ALLIANCE_HELP_COMMAND, 1000 * 4)
        result = Number(result)
    }
    catch (e) {
        console.warn(`Alliance help: no answer in ${KingdomID[castle.kingdomID]} area ${castle.areaID}`)
        return
    }

    if (result == 0) {
        console.log(`Alliance help requested in ${KingdomID[castle.kingdomID]} area ${castle.areaID}`)
        return
    }

    //Help for this queue is already running, the button is greyed out
    if (errorIs(result, "NO_MULTIPLE_ALLIANCEHELP"))
        return

    if (errorIs(result, "PLAYER_HAS_NO_ALLIANCE")) {
        noAlliance = true
        console.warn("Alliance help: you are not in an alliance")
        return
    }

    const reason = err[result] ?? result
    const key = `${castle.kingdomID}_${castle.areaID}_${reason}`
    if (reportedHelpErrors.has(key))
        return
    reportedHelpErrors.add(key)
    console.warn(`Alliance help not possible in ${KingdomID[castle.kingdomID]} area ${castle.areaID}: ${reason}`)
}

let cycleRunning = false
const runCycle = async () => {
    if (cycleRunning)
        return
    cycleRunning = true

    try {
        await visitCastles(recruitInAllCastles)
    }
    catch (e) {
        console.warn(e)
    }
    finally {
        cycleRunning = false
    }
}

const recruitInAllCastles = async enter => {
    const { troop, packageSize, allianceHelp } = getOptions()

    const chain = getLevelChain(troop.unitType)
    if (chain.length == 0) {
        console.warn("recruitUnitTypeUnknown", troop.unitType)
        return
    }

    const dcl = await ClientCommands.getDetailedCastleList()

    const castles = []
    dcl.castles.forEach(kingdom => {
        if (!RECRUIT_KINGDOMS.includes(kingdom.kingdomID))
            return

        kingdom.areaInfo.forEach(area => {
            if (!area.hasBarracks)
                return
            castles.push({ kingdomID: kingdom.kingdomID, areaID: area.areaID })
        })
    })

    if (castles.length == 0) {
        console.warn("recruitNoBarracksFound")
        return
    }

    //Coins are shared and kept up to date from "gcu", everything else we
    //let the server decide. Unknown balance -> ask for the full amount.
    let coins = Number.isFinite(playerInfo.coin) && playerInfo.coin > 0 ?
        playerInfo.coin : undefined

    const capByCoins = (unit, amount) => coins == undefined ? amount :
        Math.min(amount, Math.floor(coins / (unit.costCoins || 1)))

    const spendCoins = (unit, amount) => {
        if (coins != undefined)
            coins -= (unit.costCoins || 1) * amount
    }

    for (const castle of castles) {
        const castleKey = `${castle.kingdomID}_${castle.areaID}`

        //The server checks the barracks of the castle we are in, not the
        //one in AID, so enter the castle first like the client does.
        try {
            await enter(castle)
        }
        catch (e) {
            console.warn("recruitJoinCastleFailed", "kingdom", castle.kingdomID, "area", castle.areaID, e.message)
            continue
        }

        let recruitedUnit
        let queueWasFull = false
        let packages = 0
        let recruitedHere = 0

        //Highest level first, step down while the level is unavailable.
        for (let i = chain.length - 1; i >= 0; i--) {
            const unit = chain[i]

            const amount = capByCoins(unit, packageSize)
            if (amount <= 0) {
                console.warn("recruitNotEnoughCoins", troop.name,
                    `level ${unit.level}`, "coins", coins, "cost", unit.costCoins)
                break
            }

            let result
            try {
                result = await sendRecruit(castle, unit, amount)
            }
            catch (e) {
                console.warn("recruitNoResponse", troop.name, "kingdom", castle.kingdomID, "area", castle.areaID)
                break
            }

            if (result == 0) {
                spendCoins(unit, amount)
                recruitedUnit = unit
                packages++
                recruitedHere += amount
                break
            }

            if (isLevelLockedError(result)) {
                //Even the lowest level needs a building this castle lacks
                if (i == 0 && errorIs(result, "MISSING_REQUIRED_BUILDING") &&
                    !reportedMissingBuilding.has(castleKey)) {
                    reportedMissingBuilding.add(castleKey)
                    console.warn("recruitMissingBuilding", troop.name,
                        "kingdom", castle.kingdomID, "area", castle.areaID,
                        "needs Barracks level", unit.buildingLevel)
                }
                continue
            }

            //Full queue is the normal case, anything else is worth a look
            queueWasFull = isQueueFullError(result)
            if (!queueWasFull)
                console.warn("recruitRejected", troop.name, `level ${unit.level}`,
                    err[result] ?? result, "kingdom", castle.kingdomID, "area", castle.areaID)
            break
        }

        //The first package found the level, fill the remaining free slots with it
        let stopReason
        while (recruitedUnit && packages < MAX_PACKAGES_PER_CASTLE) {
            const amount = capByCoins(recruitedUnit, packageSize)
            if (amount <= 0) {
                stopReason = "NOT_ENOUGH_COINS"
                break
            }
            let result
            try {
                result = await sendRecruit(castle, recruitedUnit, amount)
            }
            catch (e) {
                stopReason = "NO_ANSWER"
                break
            }
            if (result != 0) {
                stopReason = err[result] ?? result
                break
            }
            spendCoins(recruitedUnit, amount)
            packages++
            recruitedHere += amount
        }

        if (recruitedUnit) {
            const queueFull = stopReason == "NO_FREE_CONSTRUCTION_SLOT"
            console[queueFull ? "log" : "warn"]("recruited", recruitedHere, troop.name,
                `level ${recruitedUnit.level}`, "in", packages, "slots",
                "kingdom", castle.kingdomID, "area", castle.areaID,
                ...(queueFull ? [] : [`(stopped: ${stopReason ?? "slot limit"})`]))
        }

        //Troops are in the queue: ask the alliance to speed them up while
        //we are still in this castle
        if (allianceHelp && (recruitedUnit || queueWasFull))
            await requestAllianceHelp(castle)
    }
}

const scheduleNext = () => setTimeout(async () => {
    await runCycle()
    scheduleNext()
}, CHECK_INTERVAL_MS).unref()

events.once("load", async () => {
    await runCycle()
    scheduleNext()
})
