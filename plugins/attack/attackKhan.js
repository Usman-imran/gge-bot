if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Select",
                key: "eventDifficulty",
                selection: [
                    "Easy",
                    "Easy+",
                    "Intermediate",
                    "Intermediate+",
                    "Hard",
                    "Hard+",
                    "Expert",
                    "Expert+",
                    "Master",
                    "Master+",
                    "Archmaster"
                ],
                default: "3"
            },
            {
                type: "Text",
                key: "commanderWhiteList"
            },
            {
                type: "Checkbox",
                key: "eventWallToolsFirst",
                default: false
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Text",
                key: "wavesTillChests",
                default: "4"
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: true
            },
            {
                type: "Checkbox",
                key: "noChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFood",
                default: true
            },
            {
                type: "Text",
                key: "scoreShutoff",
                default: "881100"
            }
        ]

    }

const troopBlackList = [277, 34, 35]
const err = require("../../err.json")
const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, spendSkip, KingdomID } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { movementEvents, waitForCommanderAvailable, commanderNumber, parseCommanderWhiteList, freeCommander, useCommander } = require("../commander.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")
const { getCommanderStats } = require("../../getEquipment.js")
const eventsDifficulties = require("../../items/eventAutoScalingDifficulties.json")
const pluginOptions = Object.assign(structuredClone(
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}),
    botConfig.plugins["attack"] ?? {})

const eventAutoScalingCamps = require("../../items/eventAutoScalingCamps.json")
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const kid = KingdomID.greatEmpire
const type = AreaType.khanCamp
const minTroopCount = 100
const eventID = 72

let campRageNeeded = NaN

const skipTarget = async AI => {
    while (AI[5] > 0) {
        let skip = spendSkip(AI[5])

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        sendXT("msd", JSON.stringify({ X: AI[1], Y: AI[2], MID: -1, NID: -1, MST: skip, KID: `${kid}` }))
        let [obj, result] = await waitForResult("msd", 7000, (obj, result) => result != 0 || obj.AI[0] == type)

        if (Number(result) != 0)
            break

        Object.assign(AI, obj.AI)
    }
}

xtHandler.on("cra", (obj, r) => {
    if (r != 0)
        return false

    if (obj.AAM.M.TA[0] != type)
        return false

    campRageNeeded = eventAutoScalingCamps.find(obj2 => obj.AAM.M.TA[9] == obj2.eventAutoScalingCampID).playerRageCap
})
xtHandler.on("cat", (obj, r) => {
    if (r != 0)
        return false
    
    const attackSource = obj.A.M.SA
    
    if (attackSource[0] != type)
        return false

    campRageNeeded = eventAutoScalingCamps.find(obj2 => 
        attackSource[9] == obj2.eventAutoScalingCampID).playerRageCap

    skipTarget(attackSource)
})
xtHandler.on("rpr", obj => {
    if (obj.EID != eventID)
        return
    
    let rage = obj.PCRP

    if (obj.PCRP >= campRageNeeded) {
        if (rage > campRageNeeded)
            console.warn("rageTooHigh")

        console.info("rageTrigger")
        sendXT("lta", JSON.stringify({ AV: 0, EID: eventID }))
    }
})
let nomadsPoints = 0
let quit = false
xtHandler.on("pep", obj => {
    if (pluginOptions.nomadsScoreShutoff <= 0)
        pluginOptions.nomadsScoreShutoff = Infinity

    if (obj.EID != eventID)
        return
    nomadsPoints = Number(obj.OP[0])
    
    if(quit)
        return

    if (nomadsPoints >= pluginOptions.nomadsScoreShutoff) {
        console.log("shuttingDownEvent", "scoreReached")
        quit = true
    }
})
events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if(quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    quit = true
})
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (eventInfo.EDID == -1) {
        const eventDifficultyID =
            Number(eventsDifficulties.find(e =>
                ((pluginOptions.eventDifficulty) + 1) == e.difficultyTypeID &&
                e.eventID == eventID)
                .difficultyID)

        sendXT("sede", JSON.stringify({ EID: eventID, EDID: eventDifficultyID, C2U: 0 }))
    }
    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kid)
        .areaInfo.find(e => AreaType.mainCastle == e.type)

    quit = false

    while (!quit) {
        const comList = parseCommanderWhiteList(pluginOptions.commanderWhiteList)

        const commander = await waitForCommanderAvailable(comList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kid)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                sendXT("fnm", JSON.stringify({ T: type, KID: kid, LMIN: -1, LMAX: -1, NID: -801 }))

                const AI = (await waitForResult("fnm", 8500, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.gaa.KID != kid)
                        return false

                    if (obj.gaa.AI[0][0] != type)
                        return false

                    return true
                }))[0].gaa.AI[0];

                await skipTarget(AI)

                const level = Number(eventAutoScalingCamps.find(obj => AI[9] == obj.eventAutoScalingCampID).camplevel)
                const attackInfo = getAttackInfo(kid, sourceCastleArea, new Types.GAAAreaInfo(AI), commander, level, undefined, pluginOptions)

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBannerKhanTools = []
                const attackerNomadTools = []
                const attackerWallNomadTools = []
                const attackerGateNomadTools = []
                const attackerShieldNomadTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if (unitInfo.ragePointBonus != undefined)
                        attackerBannerKhanTools.push([unitInfo, unit.ammount])
                    else if (unitInfo.khanTabletBooster != undefined) {
                        if (unitInfo.gateBonus)
                            attackerGateNomadTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
                            attackerWallNomadTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldNomadTools.push([unitInfo, unit.ammount])
                        else
                            attackerNomadTools.push([unitInfo, unit.ammount])
                    }
                    else if (
                        unitInfo.toolCategory &&
                        unitInfo.usageEventID == undefined &&
                        unitInfo.allowedToAttack == undefined &&
                        unitInfo.typ == 'Attack' &&
                        unitInfo.amountPerWave == undefined
                    ) {
                        if (unitInfo.wallBonus)
                            attackerWallTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
                        if(troopBlackList.includes(unitInfo.wodID))
                            continue
                        if(unitInfo.foodSupply && !pluginOptions.useFood)
                            continue

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

                attackerBannerKhanTools.sort((a, b) =>
                    Number(b[0].ragePointBonus + Number(b[0].khanTabletBooster ?? 0)) -
                    Number(a[0].ragePointBonus + Number(a[0].khanTabletBooster ?? 0)))

                attackerNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))
                attackerGateNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))
                attackerWallNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))
                attackerShieldNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))

                if (pluginOptions.lowValueChests) {
                    attackerBannerKhanTools.reverse()
                    attackerNomadTools.reverse()
                    attackerGateNomadTools.reverse()
                    attackerWallNomadTools.reverse()
                    attackerShieldNomadTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a[0].wallBonus) - Number(b[0].wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a[0].defRangeBonus) - Number(b[0].defRangeBonus))

                attackerWallNomadTools.push(...attackerWallTools)
                attackerShieldNomadTools.push(...attackerShieldTools)

                const commanderStats = getCommanderStats(commander)
                attackInfo.A.forEach((wave, index) => {
                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)

                    const desiredToolCount = attackerNomadTools.length == 0 ? 20 : 10
                    const maxTroopFront = Math.floor(getAmountSoldiersFront(level) * (1 + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100)) - 1
                    const maxTroopFlank = Math.floor(getAmountSoldiersFlank(level) * (1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100)) - 1

                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallNomadTools :
                                i == 1 ? attackerGateNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFront
                        wave.M.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        attackerMeleeTroops.sort((a, b) => Number(a[0].meleeAttack) - Number(b[0].meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a[0].rangeAttack) - Number(b[0].rangeAttack))
                        return
                    }
                    else if (!pluginOptions.noChests) {
                        const selectTool = i => {
                            let tools = pluginOptions.eventWallToolsFirst ? [] : attackerBannerKhanTools
                            if (pluginOptions.wavesTillChests <= index) {
                                tools = attackerNomadTools
                                if (tools.length == 0) {
                                    if (i == 0) {
                                        tools = attackerWallNomadTools
                                        if (tools.length == 0)
                                            tools = attackerShieldNomadTools
                                    }
                                    else if (i == 1) {
                                        tools = attackerShieldNomadTools
                                        if (tools.length == 0)
                                            tools = attackerWallNomadTools
                                    }
                                    if (i == 2) {
                                        tools = attackerGateNomadTools
                                        if (tools.length == 0)
                                            tools = attackerWallNomadTools
                                        if (tools.length == 0)
                                            tools = attackerShieldNomadTools
                                    }
                                }
                            }
                            return tools
                        }

                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                    }
                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    maxTroops = maxTroopFlank
                    wave.R.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    maxTroops = maxTroopFront
                    wave.M.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                            attackerMeleeTroops : attackerRangeTroops, maxTroops))
                });
                let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level)
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ? 
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) : 
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker,
                        Math.floor(maxTroops / 2) - 1)
                    })

                sendXT("cra", JSON.stringify(attackInfo))
                
                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kid || obj.AAM.M.TA[1] != AI[1] || obj.AAM.M.TA[2] != AI[2])
                        return false
                    return true
                })
                return { ...obj, result: r }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                continue
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]
            console.info("hittingTargetAttack", 'C', commanderNumber(attackInfo.AAM.UM.L.ID), ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
        } catch (e) {
            freeCommander(commander.lordID)
            console.warn(e)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(movementInfo) {
                        if (movementInfo.movement.movementData.kingdomID != kid)
                            return
                        if (movementInfo.movement.movementData.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "ATTACK_TOO_MANY_UNITS":
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})