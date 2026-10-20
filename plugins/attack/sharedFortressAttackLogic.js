if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const { Types, getResourceCastleList, ClientCommands, AreaType, KingdomID } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getMaxUnitsInReinforcementWave } = require("./attack")
const { movementEvents, waitForCommanderAvailable, commanderNumber, parseCommanderWhiteList, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, xtHandler, botConfig, playerInfo } = require("../../ggeBot.js")
const err = require('../../err.json')
const units = require("../../items/units.json")
const pretty = require('pretty-time')
const { getCommanderStats } = require('../../getEquipment.js')
const getAreaCached = require('../../getMap.js')

const minTroopCount = 100
const minTroopCountCY = 500
const type = AreaType.fortress

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

async function fortressHit(kingdomID, level, options) {
    options.useCoin = true
    options.useFeather = true
    
    const areas = []
    const movements = []

    xtHandler.on("gam", obj => {
        const movementsGAA = Types.GetAllMovements(obj)
        movementsGAA?.movements.forEach(movement => {
            if(kingdomID != movement.movementData.kingdomID)
                return
            
            const targetAttack = movement.movementData.targetAttack

            if(type != targetAttack.type)
                return

            if(movements.find(e => e.x == targetAttack.x && e.y == targetAttack.y))
                return

            movements.push(targetAttack)
        })
    })
    movementEvents.on("return", movementInfo => {
        const sourceAttack = movementInfo.movement.movementData.sourceAttack
        if(kingdomID != movementInfo.movement.movementData.kingdomID ||
           type != sourceAttack.type)
           return

        let index = movements.findIndex(e => e.x == sourceAttack.x && e.y == sourceAttack.y)
        if(index == -1)
            return
        movements.splice(index, 1)
    })
    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => AreaType.externalKingdom == e.type);

    const sendHit = async () => {
        const comList = parseCommanderWhiteList(options.commanderWhiteList)

        const commander = await waitForCommanderAvailable(comList,
            undefined,
            (a, b) => getCommanderStats(b).relicSpeedBonus - getCommanderStats(a).relicSpeedBonus)

        const hasShieldMadiens = !(((commander.EQ[3] ?? [])[5]?.every(([id, _]) => id == 121 ? false : true)) ?? true)
        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < areas.length; i++) {
                    const areaInfo = areas[i]
                    
                    if(movements.find(e => e.x == areaInfo.x && e.y == areaInfo.y))
                        continue

                    let time = (areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - timeSinceEpoch
                    if (time > 0)
                        continue

                    await ClientCommands.preSpyInfo(areaInfo.x, areaInfo.y, kingdomID)()
                    if ((areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - Date.now() > 0)
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                let AI = areas[index]

                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, undefined, options)

                const attackerTroops = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if (unitInfo.fightType == 0) {
                        if(kingdomID == KingdomID.firePeaks && 
                            unitInfo.wodID == 277 && !hasShieldMadiens)
                            continue
                        
                        if(!unitInfo.role)
                            continue

                        attackerTroops.push([unitInfo, unit.ammount])
                    }
                }

                attackerTroops.sort((a, b) => Number(b[0].speed) - Number(a[0].speed))

                let allTroopCount = 0

                attackerTroops.forEach(e => allTroopCount += e[1])

                if (allTroopCount < minTroopCount + (hasShieldMadiens ? 0 : minTroopCountCY))
                    throw "NO_MORE_TROOPS"

                attackInfo.A.forEach((wave, i) => {
                    if(i > 2 && kingdomID != KingdomID.firePeaks)
                        return
                    if(i > 4 && kingdomID == KingdomID.firePeaks)
                        return
                    
                    const maxTroopFlank = getAmountSoldiersFlank(level)

                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                })

                if (!hasShieldMadiens) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level)
                    attackInfo.RW.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                }

                sendXT("cra", JSON.stringify(attackInfo))
                
                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })
                
                if(r == 0) {
                    movements.push(AI)
                }
                return {...obj, result: r}
            })
            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            if(attackInfo.result != 0) 
                throw err[attackInfo.result]
            
            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', commanderNumber(attackInfo.AAM.UM.L.ID), ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
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
    
    // sendXT("fnm", JSON.stringify({T:type,KID:kid,LMIN:-1,LMAX:-1,NID:-1}))
    // let AI = new Types.GAAAreaInfo((await waitForResult("fnm", 1000 * 10, obj => {
    //     return obj.gaa.KID == kid && obj.gaa.AI[0][0] == 11
    // }))[0].gaa.AI[0])
    const getFirstFortress = async () => {
        let error = false
        let gaa
        do {
            try {
                gaa = await getAreaCached(kingdomID,
                    (1300 / 2) - 50, (1300 / 2) - 50,
                    (1300 / 2) + 50, (1300 / 2) + 50)
                error = false
            } catch (e) {
                console.warn(e)
                error = true
            }
        } while (error);

        return gaa.areaInfo.filter(e => e.type == type).sort((a, b) => 
            (Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2)) -
            (Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2)))[0]
    }
    const firstFortress = await getFirstFortress()
    areas.push(firstFortress)

    const timeSinceEpoch = Date.now()
    
    const startingX = firstFortress.x
    const startingY = firstFortress.y

    for (let j = 1;; j++) {
        let { x: rX, y: rY } = spiralCoordinates(j)
        let x = startingX + rX * 39
        let y = startingY + rY * 39        

        let error = false
        do {
            try {
                var {areaInfo: nextFortress, result} = await ClientCommands.preSpyInfo(x, y, kingdomID)()
                error = false
            } catch (e) {
                console.warn(e)
                error = true
            }
        } while (error);

        if(result != 0)
            break

        areas.push(nextFortress)

        while (await sendHit());
    }
    
    while (true) {
        let minimumTimeTillHit = Infinity
        areas.forEach(areaInfo => {
            if(!movements.find(a => a.x == areaInfo.x && a.y == areaInfo.y))
                minimumTimeTillHit = Math.min(minimumTimeTillHit, (areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000))
        })
        let time = (Math.max(0, minimumTimeTillHit - Date.now()))
        console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
        await new Promise(r => setTimeout(r, time).unref())
        
        while (await sendHit());
    }
}

module.exports = fortressHit