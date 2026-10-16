//Upgrades the Cargo buildings ("ships") in the Storm Islands castle.
//Loaded by attackStormForts.js when "auto Upgrade Ships" is ticked.
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const { sendXT, waitForResult, quietResultKeys, events } = require("../../ggeBot.js")
const { KingdomID, AreaType, MinuteSkipType, spendSkip, getResourceCastleList } = require("../../protocols.js")
const { visitCastles } = require("../../castleVisit.js")
const buildings = require("../../items/buildings.json")
const err = require("../../err.json")

const CHECK_INTERVAL_MS = 1000 * 60 * 10
const MAX_LEVEL = 10

//Client commands (C2SIsoUpgradeObjectVO / C2SMinuteSkipBuildingVO)
const UPGRADE_COMMAND = "eup"
const SKIP_COMMAND = "msb"

//IsoBuildingStateEnum: anything stopped or in progress keeps the builder busy
const BUSY_STATES = [1, 2, 12, 13]

//Storm Islands Cargo, level 1-10 (wodID 35-44)
const cargoByWodID = new Map(buildings
    .filter(b => b.name == "Cargo" && String(b.kIDs) == String(KingdomID.stormIslands))
    .map(b => [Number(b.wodID), b]))

//Price of the next level is on the next level's entry
const upgradeCost = cargo => {
    const next = buildings.find(b => b.wodID == cargo.upgradeWodID)
    return next ? Number(next.costAquamarine ?? 0) : undefined
}

//Our commands are logged here, keep ggeBot's generic result lines out
quietResultKeys.add(UPGRADE_COMMAND)
quietResultKeys.add(SKIP_COMMAND)

const send = async (command, payload) => {
    sendXT(command, JSON.stringify(payload))
    //waitForResult stretches the timeout by 2.5x
    const [obj, result] = await waitForResult(command, 1000 * 4)
    return [obj, Number(result)]
}

const readOptions = options => ({
    useSkips: Boolean(options.useTimeSkipsForShips),
    maxLevel: Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number(options.shipsMaxLevel)) || MAX_LEVEL)),
    keepAquamarine: Math.max(0, Number(options.shipsKeepAquamarine) || 0)
})

const getStormCastle = async () => {
    const castle = (await getResourceCastleList()).castles.find(e => e.kingdomID == KingdomID.stormIslands)
        ?.areaInfo.find(e => e.type == AreaType.externalKingdom)
    return castle && { kingdomID: KingdomID.stormIslands, areaID: Number(castle.extraData[0]) }
}

//Cargo buildings of the castle we are in, lowest level first
const readCargo = joinArea => joinArea.getCastleArea.buildings
    .filter(b => cargoByWodID.has(b.wodID))
    .map(b => ({
        objectID: b.ownerID, //BuildingInfo calls it ownerID, it is the object id
        level: Number(cargoByWodID.get(b.wodID).level),
        data: cargoByWodID.get(b.wodID),
        secondsLeft: b.buildTime,
        busy: BUSY_STATES.includes(b.buildingState)
    }))
    .sort((a, b) => a.level - b.level)

//Uses minute skips until the building is done, never rubies.
//Returns true when it finished.
const skipConstruction = async (objectID, secondsLeft) => {
    while (secondsLeft > 0) {
        const skip = spendSkip(secondsLeft)
        if (skip == undefined)
            return false

        const [_, result] = await send(SKIP_COMMAND, { MST: skip, OID: objectID })
        if (result != 0) {
            console.warn("cargoSkipFailed", err[result] ?? result)
            return false
        }
        secondsLeft -= MinuteSkipType[skip] * 60
    }
    return true
}

let warnedNoAquamarine = false

const upgradeCargo = async (options, enter) => {
    const { useSkips, maxLevel, keepAquamarine } = readOptions(options)

    const stormCastle = await getStormCastle()
    if (!stormCastle)
        return console.warn("cargoNoStormCastle")

    //One upgrade at a time; with skips one check can finish several
    for (let round = 0; round < MAX_LEVEL * 4; round++) {
        const joinArea = await enter(stormCastle)
        const cargo = readCargo(joinArea)
        if (cargo.length == 0)
            return console.warn("cargoNoBuildings")

        const inProgress = cargo.find(c => c.busy)
        if (inProgress) {
            //0 left but still busy: the server finishes it on its own
            if (!useSkips || inProgress.secondsLeft <= 0 ||
                !await skipConstruction(inProgress.objectID, inProgress.secondsLeft))
                return
            console.log("cargoUpgradeFinished", `level ${inProgress.level + 1}`)
            continue
        }

        const target = cargo.find(c => c.level < maxLevel && upgradeCost(c.data) != undefined)
        if (!target)
            return

        const cost = upgradeCost(target.data)
        const aquamarine = Number(joinArea.areaInfo.aqua) || 0
        if (aquamarine - cost < keepAquamarine) {
            if (!warnedNoAquamarine)
                console.log("cargoWaitingForAquamarine", `level ${target.level + 1}`, "needs", cost, "have", Math.floor(aquamarine))
            warnedNoAquamarine = true
            return
        }
        warnedNoAquamarine = false

        const [_, result] = await send(UPGRADE_COMMAND, { OID: target.objectID, PO: -1, PWR: 0 })
        if (result != 0) {
            //Builder busy with another building: try again next check
            if (err[result] != "NO_FREE_CONSTRUCTION_SLOT")
                console.warn("cargoUpgradeFailed", `level ${target.level + 1}`, err[result] ?? result)
            return
        }
        console.log("cargoUpgradeStarted", `level ${target.level} -> ${target.level + 1}`, "cost", cost)

        if (!useSkips)
            return
        //Loop again: re-entering gives the real remaining time to skip
    }
}

module.exports = options => {
    let running = false
    const check = async () => {
        if (running || !options["auto Upgrade Ships"])
            return
        running = true
        try {
            await visitCastles(enter => upgradeCargo(options, enter))
        }
        catch (e) {
            console.warn("cargoUpgradeError", e.message ?? e)
        }
        finally {
            running = false
        }
    }

    events.once("load", () => {
        check()
        setInterval(check, CHECK_INTERVAL_MS).unref()
    })
}
