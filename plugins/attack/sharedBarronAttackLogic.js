if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const { getCommanderStats } = require("../../getEquipment")
const { Types, getResourceCastleList, ClientCommands, AreaType, spendSkip, KingdomID } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { movementEvents, waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, xtHandler, botConfig, playerInfo } = require("../../ggeBot.js")
const getAreaCached = require('../../getMap.js')
const err = require("../../err.json")

const units = require("../../items/units.json")
const pretty = require('pretty-time')

const minTroopCount = 100

const troopBlackList = [277]//, 34, 35]

async function barronHit(type, kingdomID, options) {
    function getLevel(victorys, kid) {
        function getKingdomOffset(e) {
            let t = 0
            switch (e) {
                case 0:
                    t = 1
                    break
                case 2:
                    t = 20
                    break
                case 1:
                    t = 35
                    break
                case 3:
                    t = 45
            }
            return t
        }
        var n = getKingdomOffset(kid)
        return (0 | Math.floor(1.9 * Math.pow(Math.abs(victorys), .555))) + n
    }

    /**
     * One entry per castle attacks can be launched from, each holding every
     * known baron sorted by distance from that castle.
     * @type {Array<{ sourceArea: import("../../protocols.js").Types.GAAAreaInfo, sortedAreaInfo: Array<import("../../protocols.js").Types.GAAAreaInfo> }>}
     */
    let sortedAreaInfo = []
    const movements = []
    const getDistance = (a, b) =>
        Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)

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
    let skipTarget = async (AI) => {
        while (AI.extraData[2] > 0) {
            let skip = spendSkip(AI.extraData[2])

            if (skip == undefined)
                throw new Error("couldntFindSkip")

            sendXT("msd", JSON.stringify({ X: AI.x, Y: AI.y, MID: -1, NID: -1, MST: skip, KID: `${kingdomID}` }))
            let [obj2, result2] = await waitForResult("msd", 7000, (obj, result) => {
                if (result != 0)
                    return true

                if (obj.AI[0] != AI.type ||
                    obj.AI[6] != kingdomID ||
                    obj.AI[1] != AI.x ||
                    obj.AI[2] != AI.y)
                    return false
                return true
            })

            if (Number(result2) != 0)
                break

            Object.assign(AI, new Types.GAAAreaInfo(obj2.AI))
        }
    }

    xtHandler.on("cat", obj => {
        const movementInfo = Types.ReturningAttack(obj)
        const sourceAttack = movementInfo.movement.movementData.sourceAttack
        if (kingdomID != movementInfo.movement.movementData.kingdomID ||
            type != sourceAttack.type)
            return

        if(options.useTimeSkips)
            skipTarget(sourceAttack)

        let index = movements.findIndex(e => e.x == sourceAttack.x && e.y == sourceAttack.y)
        if (index == -1)
            return

        movements.splice(index, 1)
    })
    // Main castle first, outposts only when the user opted into attacking from them
    const sourceCastleAreas = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.filter(e => [AreaType.externalKingdom, AreaType.mainCastle].includes(e.type) ||
            (options.attackFromOutpost && e.type == AreaType.outpost))
        .sort((a, b) => Number(![AreaType.externalKingdom, AreaType.mainCastle].includes(a.type)) -
            Number(![AreaType.externalKingdom, AreaType.mainCastle].includes(b.type)));

    const sendHit = async () => {
        let comList = undefined
        if (![, 0, ""].includes(options.commanderWhiteList)) {
            const [start, end] = options.commanderWhiteList.split("-").map(Number).map(a => a - 1)
            comList = Array.from({ length: end - start + 1 }, (_, i) => start + i)
        }

        const commander = await waitForCommanderAvailable(comList)
        const hasShieldMadiens = !(((commander.EQ[3] ?? [])[5]?.every(([id, _]) => id == 121 ? false : true)) ?? true)
        try {
            const attackInfo = await waitToAttack(async () => {
                const detailedCastles = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                const executionStartTime = Date.now() // Start timer for "human" interaction

                const sources = sortedAreaInfo.map(entry => {
                    const sourceCastle = detailedCastles?.areaInfo
                        .find(a => a.areaID == entry.sourceArea.extraData[0])

                    const attackerMeleeTroops = []
                    const attackerRangeTroops = []

                    for (let i = 0; i < (sourceCastle?.unitInventory?.length ?? 0); i++) {
                        const unit = sourceCastle.unitInventory[i]
                        const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                        if (unitInfo == undefined)
                            continue

                        if (unitInfo.fightType == 0) {
                            if (troopBlackList.includes(unitInfo.wodID))
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

                    return { ...entry, sourceCastle, attackerMeleeTroops, attackerRangeTroops, allTroopCount }
                })

                if (!sources.some(e => e.allTroopCount >= minTroopCount))
                    throw "NO_MORE_TROOPS"

                // Hit the (castle, baron) pair with the shortest distance first
                let best = undefined
                const timeSinceEpoch = Date.now()
                for (const source of sources) {
                    if (source.allTroopCount < minTroopCount)
                        continue

                    for (let i = 0; i < source.sortedAreaInfo.length; i++) {
                        const areaInfo = source.sortedAreaInfo[i]
                        const distance = getDistance(source.sourceArea, areaInfo)

                        // Targets are sorted by distance, anything past the current
                        // best pair can only be farther away
                        if (best && distance >= best.distance)
                            break

                        if (!options.useTimeSkips) {
                            if (movements.find(e => e.x == areaInfo.x && e.y == areaInfo.y))
                                continue

                            if (((areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - timeSinceEpoch) > 0)
                                continue
                        }
                        else {
                            try {
                                await skipTarget(areaInfo)
                            }
                            catch(e) {
                                console.warn(e)
                                continue
                            }
                        }

                        best = { source, AI: areaInfo, distance }
                        break
                    }
                }
                if (best == undefined)
                    return

                const { source, AI } = best
                const { sourceCastle, attackerMeleeTroops, attackerRangeTroops } = source

                const level = getLevel(AI.extraData[1], kingdomID)
                const attackInfo = getAttackInfo(kingdomID, source.sourceArea, AI, commander, level, undefined, options)
                
                let maxWaves = parseInt(options.attackWaves)
                if (isNaN(maxWaves) || maxWaves == 0)
                    maxWaves = Infinity

                let doLeft = !!(options.attackLeft)
                let doRight = !!(options.attackRight)
                let doMiddle = !!(options.attackMiddle)
                let doCourtyard = !!(options.attackCourtyard)

                const commanderStats = getCommanderStats(commander)
                const maxTroopFront = Math.floor(getAmountSoldiersFront(level) * (1 + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100)) - 1
                const maxTroopFlank = Math.floor(getAmountSoldiersFlank(level) * (1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100)) - 1

                if (!(doLeft || doRight || doMiddle)) {
                    doLeft = true
                    if (!doCourtyard)
                        doCourtyard = hasShieldMadiens ? false : true
                }

                attackInfo.A.forEach((wave, waveIndex) => {
                    if (waveIndex >= maxWaves) return;

                    let maxTroops = maxTroopFlank

                    if (doLeft) {
                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }

                    if (doRight) {
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }

                    if (doMiddle) {
                        maxTroops = maxTroopFront
                        wave.M.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                })

                if (doCourtyard) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level)
                    attackInfo.RW.forEach((unitSlot, i) => {
                        let attacker = i & 1 ?
                            (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                            (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                        maxTroops -= assignUnit(unitSlot, attacker,
                            Math.floor(maxTroops / 2) - 1)
                    })
                }

                sendXT("cra", JSON.stringify(attackInfo))

                let [obj, result] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })
                if (result == 0) {
                    attackInfo.A.forEach(wave => {
                        wave.L.U.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))
                        wave.R.U.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))
                        wave.M.U.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))

                        wave.L.T.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))
                        wave.R.T.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))
                        wave.M.T.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))

                        attackInfo.RW.forEach(slot => slot[0] != -1 && (sourceCastle.unitInventory.find(e => e?.unitID == slot[0]).ammount -= slot[1]))
                    })
                    if (!options.useTimeSkips)
                        movements.push(AI)
                }

                const executionDuration = ((Date.now() - executionStartTime) / 1000).toFixed(2);
                obj.executionDuration = executionDuration; // Pass it out

                return { ...obj, attackInfo, result, executionDuration }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            if (attackInfo.result != 0) {
                console.debug(`${JSON.stringify(attackInfo)}`)
                throw err[attackInfo.result]
            }
            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    try {
                        if (botConfig.externalEvent && kingdomID == KingdomID.greatEmpire) {
                            await (require("../../plugins-extra/externalEventHelper.js"))
                                .recruitTroops()
                            return true
                        }
                    }
                    catch (e) {
                        console.debug(e)
                    }
                    console.log(`[${KingdomID[kingdomID]}] Waiting for more troops`)
                    await new Promise(resolve => movementEvents.on("return", function self(movementInfo) {
                        if (movementInfo.movement.movementData.kingdomID != kingdomID)
                            return
                        if (!sourceCastleAreas.some(e => e.extraData[0] == movementInfo.movement.movementData.targetAttack.extraData[0]))
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "ATTACK_TOO_MANY_UNITS":
                    return true
                case "CANT_START_NEW_ARMIES":
                default:
                    throw e
            }
        }
    }
    /** @type {Map<string, import("../../protocols.js").Types.GAAAreaInfo>} */
    const uniqueTargets = new Map()
    for (const sourceArea of sourceCastleAreas) {
        /** @type {import("../../protocols.js").Types.ServerGetAreaInfo} */
        let gaa
        do {
            try {
                gaa = await getAreaCached(kingdomID,
                    sourceArea.x - 50, sourceArea.y - 50,
                    sourceArea.x + 50, sourceArea.y + 50)
                error = false
            } catch (e) {
                console.warn(e)
                error = true
            }
        } while (error);

        gaa.areaInfo.filter(ai => ai.type == type)
            .forEach(ai => uniqueTargets.set(`${ai.x}_${ai.y}`, ai))
    }

    for (const sourceArea of sourceCastleAreas) {
        sortedAreaInfo.push({
            sourceArea,
            sortedAreaInfo: Array.from(uniqueTargets.values())
                .sort((a, b) => getDistance(sourceArea, a) - getDistance(sourceArea, b))
        })
    }

    while (true) {
        if (!options.useTimeSkips) {
            let minimumTimeTillHit = Infinity

            uniqueTargets.forEach(ai => {
                if (!movements.find(a => a.x == ai.x && a.y == ai.y))
                    minimumTimeTillHit = Math.min(minimumTimeTillHit, (ai.timeSinceRequest + ai.extraData[2] * 1000))
            })
            let time = (Math.max(0, minimumTimeTillHit - Date.now()))
            if (time > 0)
                console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
            await new Promise(r => setTimeout(r, time).unref())
        }

        while (await sendHit());
    }
}

module.exports = barronHit