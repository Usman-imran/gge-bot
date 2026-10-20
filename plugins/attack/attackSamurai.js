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
                default : 3
            },
            {
                type: "Text",
                key: "commanderWhiteList"
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "noChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Text",
                key: "scoreShutoff"
            }
        ]

    }

const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, spendSkip, getEventList } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack")
const { movementEvents, waitForCommanderAvailable, commanderNumber, parseCommanderWhiteList, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")
const { getCommanderStats } = require("../../getEquipment")
const eventsDifficulties = require("../../items/eventAutoScalingDifficulties.json")
const pluginOptions = Object.assign(structuredClone(
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}),
    botConfig.plugins["attack"] ?? {})
const err = require('../../err.json')

const kingdomID = 0
const type = AreaType.samCamp

const eventAutoScalingCamps = require("../../items/eventAutoScalingCamps.json")
const units = require("../../items/units.json")
const pretty = require('pretty-time')
const getAreaCached = require("../../getMap")

const minTroopCount = 100
const eventID = 80
let samsPoints = 0

const skipTarget = async (AI) => {
    while (AI.extraData[2] > 0) {
        let skip = spendSkip(AI.extraData[2])

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        sendXT("msd", JSON.stringify({ X: AI.x, Y: AI.y, MID: -1, NID: -1, MST: skip, KID: `${kingdomID}` }))
        let [obj, result] = await waitForResult("msd", 7000, (obj, result) => {
            return result != 0 ||
                new Types.GAAAreaInfo(obj.AI).type == type
        })

        if (Number(result) != 0)
            break

        Object.assign(AI, new Types.GAAAreaInfo(obj.AI))
    }
}

xtHandler.on("cat", (obj, result) => {
    if (result != 0)
        return

    let attackSource = obj.A.M.SA

    if (attackSource[0] != type)
        return

    skipTarget(new Types.GAAAreaInfo(attackSource))
})
let quit = false
xtHandler.on("pep", obj => {
    if (pluginOptions.scoreShutoff <= 0)
        pluginOptions.scoreShutoff = Infinity

    if (obj.EID != eventID)
        return
    samsPoints = Number(obj.OP[0])
    
    if(quit)
        return

    if (samsPoints >= pluginOptions.scoreShutoff) {
        console.log("shuttingDownEvent", "ScoreReached")
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
    if(eventInfo.EID != eventID)
        return

    if (eventInfo.EDID == -1) {
        const eventDifficultyID = 
            Number(eventsDifficulties.find(e => 
                ((pluginOptions.eventDifficulty) + 1) == e.difficultyTypeID && 
                e.eventID == eventID)
                .difficultyID)
                
        sendXT("sede", JSON.stringify({ EID: eventID, EDID: eventDifficultyID, C2U: 0 }))
    }

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => AreaType.mainCastle == e.type);
    let error = false
    let gaa
    do {
        try {
            gaa = await getAreaCached(kingdomID,
                sourceCastleArea.x - 50, sourceCastleArea.y - 50,
                sourceCastleArea.x + 50, sourceCastleArea.y + 50)
            error = false
        } catch (e) {
            console.error(e)
            error = true
        }
    } while (error);
    let areaInfo = gaa.areaInfo.filter(ai => ai.type == type)
        .sort((a, b) => 
            (Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2)) -
            (Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2)))
        .sort((a, b) => a.extraData[6] - b.extraData[6])

    quit = false

    while (!quit) {
        const comList = parseCommanderWhiteList(pluginOptions.commanderWhiteList)

        const commander = await waitForCommanderAvailable(comList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                const AI = areaInfo.shift()

                areaInfo.push(AI)

                // await ClientCommands.preSpyInfo(AI.x, AI.y, kingdomID)()

                await skipTarget(AI)

                const level = 
                    Number(eventAutoScalingCamps.find(obj => 
                        AI.extraData[5] == obj.eventAutoScalingCampID).camplevel)
                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, undefined, pluginOptions)

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerSamuraiTools = []
                const attackerWallSamuraiTools = []
                const attackerGateSamuraiTools = []
                const attackerShieldSamuraiTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if(unitInfo.wodID == 277)
                        continue

                    else if (unitInfo.samuraiTokenBooster != undefined) {
                        if (unitInfo.gateBonus)
                            attackerGateSamuraiTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
                            attackerWallSamuraiTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldSamuraiTools.push([unitInfo, unit.ammount])
                        else
                            attackerSamuraiTools.push([unitInfo, unit.ammount])
                    }
                    else if (
                        unitInfo.toolCategory &&
                    unitInfo.usageEventID  == undefined &&
                    unitInfo.allowedToAttack  == undefined &&
                    unitInfo.typ == 'Attack' &&
                    unitInfo.amountPerWave == undefined
                    ) {
                        if (unitInfo.wallBonus)
                            attackerWallTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
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

                attackerSamuraiTools.sort((a, b) =>
                    Number(b[0].samuraiTokenBooster) - Number(a[0].samuraiTokenBooster))
                attackerGateSamuraiTools.sort((a, b) =>
                    Number(b[0].samuraiTokenBooster) - Number(a[0].samuraiTokenBooster))
                attackerWallSamuraiTools.sort((a, b) =>
                    Number(b[0].samuraiTokenBooster) - Number(a[0].samuraiTokenBooster))
                attackerShieldSamuraiTools.sort((a, b) =>
                    Number(b[0].samuraiTokenBooster) - Number(a[0].samuraiTokenBooster))

                if (pluginOptions.lowValueChests) {
                    attackerSamuraiTools.reverse()
                    attackerGateSamuraiTools.reverse()
                    attackerWallSamuraiTools.reverse()
                    attackerShieldSamuraiTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a[0].wallBonus) - Number(b[0].wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a[0].defRangeBonus) - Number(b[0].defRangeBonus))

                attackerWallSamuraiTools.push(...attackerWallTools)
                attackerShieldSamuraiTools.push(...attackerShieldTools)

                attackInfo.A.forEach((wave, index) => {
                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)

                    const desiredToolCount = attackerSamuraiTools.length == 0 ? 20 : 10
                    const commanderStats = getCommanderStats(commander)
                    const maxTroopFront = Math.floor(getAmountSoldiersFront(level) * (1 + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100)) - 1
                    const maxTroopFlank = Math.floor(getAmountSoldiersFlank(level) * (1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100)) - 1

                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallSamuraiTools : attackerShieldSamuraiTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallSamuraiTools : attackerShieldSamuraiTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallSamuraiTools :
                                i == 1 ? attackerGateSamuraiTools : attackerShieldSamuraiTools, Math.min(maxTools, desiredToolCount)))

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
                    else if(!pluginOptions.noChests) {
                        const selectTool = i => {
                            let tools = attackerSamuraiTools
                            if (tools.length == 0) {
                                if (i == 0) {
                                    tools = attackerWallSamuraiTools
                                    if (tools.length == 0)
                                        tools = attackerShieldSamuraiTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldSamuraiTools
                                    if (tools.length == 0)
                                        tools = attackerWallSamuraiTools
                                }
                                if (i == 2) {
                                    tools = attackerGateSamuraiTools
                                    if (tools.length == 0)
                                        tools = attackerWallSamuraiTools
                                    if (tools.length == 0)
                                        tools = attackerShieldSamuraiTools
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
                })
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

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })
                return {...obj, result: r}
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                continue
            }
            if(attackInfo.result != 0) 
                throw err[attackInfo.result]
            
            console.info("hittingTargetAttack", 'C', commanderNumber(attackInfo.AAM.UM.L.ID), ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
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
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
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