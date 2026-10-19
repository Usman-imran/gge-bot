if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "feastFoodReduction",
                default: "150000"
            },
            {
                type: "Text",
                key: "minimumFood",
                default: "0"
            },
            {
                type: "Text",
                key: "minimumFoodRate",
                default: "0"
            },
        ]
    }
    return
}

const { ClientCommands, KingdomID } = require("../protocols.js")
const { events, botConfig, quietResultKeys } = require("../ggeBot.js")
const err = require("../err.json")

//Checks every castle on this timer, not only right after login
const CHECK_INTERVAL_MS = 1000 * 60 * 20
const FEAST_TYPE = 8
//Safety stop so a castle can never loop forever in one check
const MAX_FEASTS_PER_CASTLE = 20

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const numberOption = (value, fallback) => value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback
//Food one feast costs
const feastFoodReduction = numberOption(pluginOptions.feastFoodReduction, 150000)
//Food that must be left in the castle after feasting
const minimumFood = numberOption(pluginOptions.minimumFood, 0)
//Only castles that produce at least this much food per hour (0 = no check)
const minimumFoodRate = numberOption(pluginOptions.minimumFoodRate, 0)

//Feast errors are logged here once per castle, not by waitForResult every time
quietResultKeys.add("bfs")
const reportedErrors = new Set()

const foodRate = area => {
    const production = area.getProductionData
    return production.deltaFood - production.FoodConsumptionRate * (1 - (production.foodConsumptionReductionPercentage || 0))
}

const castleLabel = (kingdomID, areaID) => `${KingdomID[kingdomID] ?? `kingdom ${kingdomID}`} area ${areaID}`

const feastInCastle = async (kingdomID, area) => {
    let feasts = 0
    let food = area.food
    while (feasts < MAX_FEASTS_PER_CASTLE && food >= feastFoodReduction && food - feastFoodReduction >= minimumFood) {
        const feast = await ClientCommands.startFeast(FEAST_TYPE, area.areaID, kingdomID)()
        if (feast.result != 0) {
            const reason = err[feast.result] ?? feast.result
            const key = `${kingdomID}_${area.areaID}_${reason}`
            if (!reportedErrors.has(key)) {
                reportedErrors.add(key)
                console.warn(`Feast failed in ${castleLabel(kingdomID, area.areaID)}: ${reason}`)
            }
            break
        }
        feasts++
        food -= feastFoodReduction
    }
    if (feasts > 0)
        console.log(`Feast bought ${feasts}x in ${castleLabel(kingdomID, area.areaID)}, used ${feasts * feastFoodReduction} food`)
}

let running = false
const checkAllCastles = async () => {
    if (running)
        return
    running = true
    try {
        const dcl = await ClientCommands.getDetailedCastleList()
        for (const castle of dcl.castles) {
            if (castle.kingdomID == KingdomID.stormIslands || castle.kingdomID == KingdomID.berimond)
                continue

            for (const area of castle.areaInfo) {
                if (minimumFoodRate != 0 && foodRate(area) < minimumFoodRate)
                    continue
                try {
                    await feastInCastle(castle.kingdomID, area)
                }
                catch (e) {
                    console.warn(`Feast failed in ${castleLabel(castle.kingdomID, area.areaID)}: ${e?.message ?? e}`)
                }
            }
        }
    }
    catch (e) {
        console.warn(`Feast check failed: ${e?.message ?? e}`)
    }
    finally {
        running = false
    }
}

events.once("load", () => {
    checkAllCastles()
    setInterval(checkAllCastles, CHECK_INTERVAL_MS)
})
