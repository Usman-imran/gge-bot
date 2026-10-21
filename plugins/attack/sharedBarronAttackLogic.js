if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const { getCommanderStats } = require("../../getEquipment")
const { Types, getResourceCastleList, ClientCommands, AreaType, spendSkip, KingdomID } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { movementEvents, waitForCommanderAvailable, commanderNumber, parseCommanderWhiteList, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, xtHandler, botConfig, playerInfo } = require("../../ggeBot.js")
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
    /**
     * Barons our own attacks are on the way to: { x, y, until (arrival time) }.
     * Only own movements count, and an entry ends at arrival at the latest,
     * so a missed "cat" can't block a baron for good.
     */
    const movements = []
    const getDistance = (a, b) =>
        Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)
    const isUnderAttack = target => {
        const now = Date.now()
        for (let i = movements.length - 1; i >= 0; i--)
            if (movements[i].until <= now)
                movements.splice(i, 1)
        return movements.some(e => e.x == target.x && e.y == target.y)
    }
    const markUnderAttack = (target, secondsLeft) => {
        if (isUnderAttack(target))
            return
        movements.push({ x: target.x, y: target.y, until: Date.now() + (Math.max(0, secondsLeft) + 5) * 1000 })
    }
    const freeTarget = target => {
        const index = movements.findIndex(e => e.x == target.x && e.y == target.y)
        if (index != -1)
            movements.splice(index, 1)
    }
    /** All known barons by "x_y", filled once at start below. */
    const uniqueTargets = new Map()
    //A baron gets a new cooldown when hit (by us or anyone else): read it again
    //from the map, the start-up data would make it look free.
    const refreshTarget = async target => {
        const known = uniqueTargets.get(`${target.x}_${target.y}`)
        if (!known)
            return undefined
        try {
            const gaa = await ClientCommands.getAreaInfo(kingdomID, known.x, known.y, known.x, known.y)()
            const fresh = gaa?.areaInfo?.find(e => e.x == known.x && e.y == known.y && e.type == known.type)
            if (fresh)
                Object.assign(known, fresh)
        }
        catch (e) {
            console.debug(e)
        }
        return known
    }

    xtHandler.on("gam", obj => {
        Array.from(obj?.M ?? []).forEach(raw => {
            const movement = raw?.M
            //Other players' attacks (e.g. alliance members) are not ours to track
            if (movement == undefined || movement.OID != playerInfo.playerID)
                return
            if (kingdomID != movement.KID)
                return

            const targetAttack = new Types.GAAAreaInfo(movement.TA)
            if (type != targetAttack.type)
                return

            markUnderAttack(targetAttack, movement.TT - movement.PT)
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

        //The hit baron now has a cooldown: read it before it counts as free
        //again (and skip the cooldown when allowed)
        refreshTarget(sourceAttack).then(target => {
            freeTarget(sourceAttack)
            if (target && options.useTimeSkips)
                skipTarget(target).catch(e => console.debug(e))
        })
    })
    // Main castle first, outposts only when the user opted into attacking from them
    const sourceCastleAreas = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.filter(e => [AreaType.externalKingdom, AreaType.mainCastle].includes(e.type) ||
            (options.attackFromOutpost && e.type == AreaType.outpost))
        .sort((a, b) => Number(![AreaType.externalKingdom, AreaType.mainCastle].includes(a.type)) -
            Number(![AreaType.externalKingdom, AreaType.mainCastle].includes(b.type)));

    const sendHit = async () => {
        const comList = parseCommanderWhiteList(options.commanderWhiteList)

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
                            if (isUnderAttack(areaInfo))
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
                        markUnderAttack(AI, obj.AAM.M.TT - obj.AAM.M.PT)
                }
                //Someone else hit it since we read the map: get its real cooldown,
                //so the next pick moves on to the next nearest free baron
                else if (err[result] == "COOLING_DOWN")
                    await refreshTarget(AI)

                const executionDuration = ((Date.now() - executionStartTime) / 1000).toFixed(2);
                obj.executionDuration = executionDuration; // Pass it out

                return { ...obj, attackInfo, result, executionDuration, hitFrom: source.sourceArea, hitDistance: best.distance }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            if (attackInfo.result != 0) {
                console.debug(`${JSON.stringify(attackInfo)}`)
                throw err[attackInfo.result]
            }
            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', commanderNumber(attackInfo.AAM.UM.L.ID), ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack", ` (${fields(attackInfo.hitDistance)} fields from ${attackInfo.hitFrom.x}:${attackInfo.hitFrom.y})`)
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
    //The map around each castle (50 fields each way) is read in four 50x50
    //pieces, kept inside the map (0-1286). Every piece is checked, so no part
    //of the area (and none of its barons) can go missing.
    const MAP_MAX = 1286, RANGE = 50
    const clamp = v => Math.min(MAP_MAX, Math.max(0, v))
    const readArea = async (x1, y1, x2, y2) => {
        for (let attempt = 1; ; attempt++) {
            try {
                const gaa = await ClientCommands.getAreaInfo(kingdomID, x1, y1, x2, y2)()
                if (gaa.result == 0 || attempt >= 5)
                    return (gaa.areaInfo ?? []).filter(ai => ai.x >= x1 && ai.x <= x2 && ai.y >= y1 && ai.y <= y2)
            } catch (e) {
                if (attempt >= 5) {
                    console.warn(`[${KingdomID[kingdomID]}] Could not read the map at ${x1}:${y1}`, e)
                    return []
                }
            }
        }
    }
    const readBaronsAround = async sourceArea => {
        const found = []
        for (const [dx, dy] of [[-RANGE, -RANGE], [0, -RANGE], [-RANGE, 0], [0, 0]]) {
            const x1 = clamp(sourceArea.x + dx), y1 = clamp(sourceArea.y + dy)
            const x2 = clamp(sourceArea.x + dx + RANGE), y2 = clamp(sourceArea.y + dy + RANGE)
            found.push(...(await readArea(x1, y1, x2, y2)).filter(ai => ai.type == type))
        }
        return found
    }
    const fields = distance => Math.round(Math.sqrt(distance))
    //Reads all barons again: new cooldowns (also from other players' hits)
    const loadBarons = async () => {
        for (const sourceArea of sourceCastleAreas)
            for (const ai of await readBaronsAround(sourceArea)) {
                const known = uniqueTargets.get(`${ai.x}_${ai.y}`)
                if (known)
                    Object.assign(known, ai)
                else
                    uniqueTargets.set(`${ai.x}_${ai.y}`, ai)
            }

        sortedAreaInfo = sourceCastleAreas.map(sourceArea => ({
            sourceArea,
            sortedAreaInfo: Array.from(uniqueTargets.values())
                .sort((a, b) => getDistance(sourceArea, a) - getDistance(sourceArea, b))
        }))
    }
    await loadBarons()
    for (const { sourceArea, sortedAreaInfo: list } of sortedAreaInfo) {
        const nearest = list[0] ? `, nearest ${list[0].x}:${list[0].y} (${fields(getDistance(sourceArea, list[0]))} fields)` : ""
        console.log(`[${KingdomID[kingdomID]}] ${list.length} barons around castle ${sourceArea.x}:${sourceArea.y}${nearest}`)
    }
    setInterval(() => loadBarons().catch(e => console.debug(e)), 1000 * 60 * 30).unref()

    while (true) {
        if (!options.useTimeSkips) {
            let minimumTimeTillHit = Infinity

            uniqueTargets.forEach(ai => {
                if (!isUnderAttack(ai))
                    minimumTimeTillHit = Math.min(minimumTimeTillHit, (ai.timeSinceRequest + ai.extraData[2] * 1000))
            })
            //Every baron under attack: check again when the first attack lands
            if (minimumTimeTillHit == Infinity && movements.length > 0)
                minimumTimeTillHit = Math.min(...movements.map(e => e.until))
            let time = Number.isFinite(minimumTimeTillHit) ? Math.max(0, minimumTimeTillHit - Date.now()) : 1000 * 60
            if (time > 0)
                console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
            await new Promise(r => setTimeout(r, time).unref())
        }

        while (await sendHit());
    }
}

module.exports = barronHit