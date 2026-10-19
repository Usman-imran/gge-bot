if (require('node:worker_threads').isMainThread) {
    module.exports = {
        force: true,
        pluginOptions: [
            {
                type: "Text",
                key: "attackDelaySeconds",
                default: "4.0"
            },
            {
                type: "Text",
                key: "attackDelayRandomizationSeconds",
                default: "3.0"
            },
            {
                "type": "Text",
                "key": "attackLimit",
                "default": ""
            }
        ]
    }
    return
}
const { DatabaseSync } = require('node:sqlite')
const { getPermanentCastle } = require('../../protocols')
const { botConfig, playerInfo, xtHandler } = require('../../ggeBot')
const stables = require('../../items/horses.json')
const { getCommanderStats } = require('../../getEquipment')

const userDatabase = new DatabaseSync('./user.db', { timeout: 1000 * 60 })

const { setTimeTillTimeout, setLastHitTime, setTimeSpentInTimeout } = (() => {
    while (true) {
        try {
            userDatabase.prepare('INSERT OR IGNORE INTO PlayerInfo (id, timeTillTimeout, lastHitTime, timeSpentInTimeout) VALUES(?,?,?,?)')
                .run(botConfig.id, 0, 0, 0)
            return ({
                setTimeTillTimeout: userDatabase.prepare('UPDATE PlayerInfo SET timeTillTimeout = ? WHERE id = ?'),
                setLastHitTime: userDatabase.prepare('UPDATE PlayerInfo SET lastHitTime = ? WHERE id = ?'),
                setTimeSpentInTimeout: userDatabase.prepare('UPDATE PlayerInfo SET timeSpentInTimeout = ? WHERE id = ?'),
            })
        }
        catch (e) {
            console.debug("Possibly needs to be cleared:")
            console.debug(e)
            try {
                userDatabase.exec(`DROP TABLE "PlayerInfo"`)
            } catch {}
            userDatabase.exec(`CREATE TABLE IF NOT EXISTS "PlayerInfo" (
            "id"	INTEGER UNIQUE,
            "timeTillTimeout"	INTEGER,
            "lastHitTime"	INTEGER,
            "timeSpentInTimeout" INTEGER,
            PRIMARY KEY("id")
            )`)
        }
    }
})();


let {timeTillTimeout, lastHitTime, timeSpentInTimeout} = userDatabase.prepare('Select timeTillTimeout, lastHitTime From PlayerInfo WHERE id=?')
    .get(botConfig.id)

timeTillTimeout = 0
lastHitTime = 0

const getTotalAmountTools = (e, t, n) =>
    1 === e ? t < 11 ? 10 :
        t < 37 ? 20 :
            t < 50 ? 30 :
                t < 69 ? 40 : 50 : //TODO: WTF
        t < 37 ? 10 :
            t < 50 ? 20 :
                t < 69 ? 30 : 0 | Math.ceil(40 + n)

const getTotalAmountToolsFlank = (e, t) => getTotalAmountTools(0, e, t)
const getTotalAmountToolsFront = e => getTotalAmountTools(1, e, 0)

const getMaxAttackers = targetLevel =>
    targetLevel <= 69 ? Math.min(260, 5 * targetLevel + 8) : 320
const getAmountSoldiersFlank = e => Math.floor(0 | Math.ceil(.2 * getMaxAttackers(e)))
const getAmountSoldiersFront = e => Math.floor(0 | Math.ceil(getMaxAttackers(e) - 2 * getAmountSoldiersFlank(e)))
const getMaxUnitsInReinforcementWave = (playerlevel, targetLevel) =>
    0 | Math.round(20 * Math.sqrt(playerlevel) + 50 + 20 * targetLevel)

function getMaxWaveCount(e) {
    const waveUnlockLevelList = [0, 13, 26, 51]
    for (var n = 1, i = waveUnlockLevelList.length - 1; i >= 0; i--)
        if (e >= waveUnlockLevelList[i]) {
            n = i + 1
            break
        }
    return n
}

function assignUnit(unitSlot, units, maxUnits) {
    let unit = units[0]
    if (!unit)
        return 0

    let unitType = unit[0].wodID
    let unitAmmount = Math.floor(Math.max(Math.min(unit[1], maxUnits),0))

    unit[1] -= unitAmmount

    if (unit[1] <= 0)
        units.shift()

    if (unitAmmount > 0) {
        unitSlot[0] = unitType
        unitSlot[1] = unitAmmount
    }

    return unitAmmount
}
function getAttackInfo(kid, sourceCastle, AI, commander, level, waves, options) {
    const attackTarget = {
        SX: sourceCastle.x,
        SY: sourceCastle.y,
        TX: AI.x,
        TY: AI.y,
        KID: kid,
        LID: commander.lordID,
        WT: 0,
        HBW: -1,
        BPC: 0,
        ATT: 0,
        AV: 0,
        LP: 0,
        FC: 0,
        PTT: 1,
        SD: 0,
        ICA: 0,
        CD: 99,
        A: [],
        BKS: [],
        AST: [
            -1,
            -1,
            -1
        ],
        RW: [ //TODO: SET THIS UP PROPERLY
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ]
            ],
        ASCT: 0
    }

    const getMaxWaves = () => {
        let waves = getMaxWaveCount(playerInfo.level)

        try {
            commander.EQ[4][5].forEach(([id, effectarray]) =>
                id == 21 ? waves += effectarray[0] : void 0)
        }
        catch { }

        const commanderStats = getCommanderStats(commander)

        if (commanderStats.relicAdditionalWaves)
            waves += commanderStats.relicAdditionalWaves

        return waves
    }
    
    waves = Math.min(waves ?? Infinity, getMaxWaves())

    for (let i = 0; i < waves; i++) {
        const wave = {
            L: {
                T: [],
                U: []
            },
            R: {
                T: [],
                U: []
            },
            M: {
                T: [],
                U: []
            }
        }
        const setupWave = (wallLevelRequirement, row) =>
            wallLevelRequirement.every(e =>
                e <= level ? row.push([-1, 0]) : false)

        setupWave([0, 37], wave.L.T)
        setupWave([0, 13], wave.L.U)
        setupWave([0, 11, 37], wave.M.T)
        setupWave([0, 0, 13, 13, 26, 26], wave.M.U)
        setupWave([0, 37], wave.R.T)
        setupWave([0, 13], wave.R.U)
        attackTarget.A.push(wave)
    }
    const castleData = getPermanentCastle().find(e => e.kingdomID == kid &&
        (kid == 10 || e.areaID == sourceCastle.extraData[0]))
    const unlockedHorses = castleData?.unlockedHorses

    if (options.useCoin && !options.useFeather) {
        let bestHorse = -1
        let minSpeed = Infinity

        unlockedHorses?.forEach(e => {
            let horse = stables.find(a => e == a.wodID)
            // Check for Gold Cost (>0) and Ruby Cost (==0)
            if (horse && Number(horse.costFactorC1) > 0 && Number(horse.costFactorC2) == 0) {
                 if (Number(horse.unitBoost) < minSpeed) {
                    minSpeed = Number(horse.unitBoost)
                    bestHorse = e
                }
            }
        })
        
        if (bestHorse != -1) {
            attackTarget.HBW = bestHorse
            attackTarget.PTT = 0
        } else {
            console.debug("noStablesCoinHorse")
            attackTarget.HBW = -1
            attackTarget.PTT = 0
        }
    }
    else {
        attackTarget.HBW = -1
        attackTarget.PTT = options.useFeather ? 1 : 0
    }
    
    return attackTarget
}

// Box-Muller transform for Gaussian distribution (Human-like randomness)
function boxMullerRandom(min, max, skew) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );

    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) num = boxMullerRandom(min, max, skew); // resample between 0 and 1 if out of range
    num = Math.pow(num, skew); // Skew
    num *= max - min; // Stretch to fill range
    num += min; // offset to min
    return num;
}

const sleep = ms => new Promise(r => setTimeout(r, ms).unref())

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const attacks = []
let alreadyRunning = false
const napTime = 1000 * 60 * 60 * 2
let attackCount = undefined
let attackThreshold = undefined

if([,""].includes(pluginOptions.attackLimit))
    pluginOptions.attackLimit = undefined
    
let announced = false
xtHandler.on("gai", obj => {
    attackCount = obj.AC
    attackThreshold = obj.ACTH
    //Count went down again (game reset): announce the next time the limit is hit
    if (attackCount < Number(pluginOptions.attackLimit ?? attackThreshold))
        announced = false
})
const waitToAttack = callback => new Promise((resolve, reject) => {
    if(!botConfig.externalEvent && attackCount >= Number(pluginOptions.attackLimit ?? attackThreshold)) {
        if(!announced) {
            announced = true
            console.log("Max attacks reached")
        }
        return reject("ATTACK_LIMIT_REACHED")
    }

    if (timeTillTimeout == 0) {
        timeTillTimeout = Date.now() + napTime
        setTimeTillTimeout.run(timeTillTimeout, botConfig.id)
    }

    attacks.push(() => {
        try {
            ret = callback()
            resolve(ret)
            return ret
        }
        catch (e) {
            reject(e)
            return true
        }
    })
    
    if (!alreadyRunning) {
        alreadyRunning = true
        setImmediate(async () => {
            do {
                try {
                    // Human-like delay logic using Gaussian distribution
                    // Base delay from config + random gaussian variance
                    const baseDelay = parseInt(pluginOptions.attackDelaySeconds)
                    const variance = parseInt(pluginOptions.attackDelayRandomizationSeconds)

                    // Generate a natural random delay. Skew 1 means normal distribution.
                    const naturalDelay = boxMullerRandom(baseDelay * 1000, (baseDelay + variance) * 1000, 1)

                    console.debug("attackDelayAttack", naturalDelay)

                    const time = Date.now()
                    const deltaLastHitTime = lastHitTime - time
                    const deltaTimeTillTimeout = timeTillTimeout - time
                    const takeBreak = async (timeTillNextHit) => {
                        if (timeTillNextHit > 0) {
                            timeSpentInTimeout = time + timeTillNextHit
                            console.log("takingBreakPreventBan", Math.round(timeTillNextHit / 1000 / 60))
                            await sleep(timeTillNextHit)
                        }
                        timeTillTimeout = Date.now() + napTime
                        setTimeTillTimeout.run(timeTillTimeout, botConfig.id)
                        timeSpentInTimeout = 0
                        setTimeSpentInTimeout.run(timeSpentInTimeout, botConfig.id)
                    }
                    if(timeSpentInTimeout > 0)
                        await takeBreak(timeSpentInTimeout - time)
                    else if (deltaTimeTillTimeout + deltaLastHitTime <= 0)
                        await takeBreak(1000 * 60 * 30 - (deltaTimeTillTimeout - deltaLastHitTime))

                    lastHitTime = Date.now()
                    setLastHitTime.run(lastHitTime, botConfig.id)

                    if (!await (attacks.shift()()))
                        continue

                    await sleep(naturalDelay)
                } catch (innerError) {
                    // Catch errors specific to the task but keep the loop running
                    if (innerError !== "NO_MORE_TROOPS") {
                        console.warn("failedToHandleAttack", innerError)
                        console.error(innerError)
                    }
                }
            }
            while (attacks?.length > 0);
            alreadyRunning = false
        })
    }
})

module.exports = {
    getAttackInfo,
    assignUnit,
    waitToAttack,
    getTotalAmountToolsFlank,
    getTotalAmountToolsFront,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    boxMullerRandom,
    sleep
}
