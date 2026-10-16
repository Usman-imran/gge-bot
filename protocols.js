const fs = require("fs/promises")
const { RateLimiter } = require("limiter")
const { PerformanceObserver } = require('node:perf_hooks')
const { waitForResult, sendXT, xtHandler, events } = require("./ggeBot.js")

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

const map = {}
const AreaType = Object.freeze({
    barron: 2,
    outpost: 4,
    externalKingdom: 12,
    mainCastle: 1,
    nomadCamp: 27,
    stormIsland: 24,
    samCamp: 29,
    beriCamp: 30,
    watchTower: 17,
    capital: 3,
    fortress : 11,
    beriCastle : 15,
    stormTower : 25,
    khanCamp : 35
});
const HighscoreType = Object.freeze({
    honour: 5
});
const MinuteSkipType = Object.freeze({
    MS1: 1,
    MS2: 5,
    MS3: 10,
    MS4: 30,
    MS5: 60,
    MS6: 60 * 5,
    MS7: 60 * 24,
});

const skips = {
    MS1: 0,
    MS2: 0,
    MS3: 0,
    MS4: 0,
    MS5: 0,
    MS6: 0,
    MS7: 0
}

/**
 * @param {GAAAreaInfo} AI 
 * @param {Number} kingdomID 
 * @param {Boolean} shouldEmit
 */
const MapObject = (AI, kingdomID) => {
    if(kingdomID == undefined)
        return
    /** @type {GAAAreaInfo} */
    const obj = map[`${kingdomID}_${AI.x}_${AI.y}`]?.deref()
        ?? (map[`${kingdomID}_${AI.x}_${AI.y}`] = new WeakRef(AI), AI)

    Object.assign(obj, AI)

    if(JSON.stringify(obj.extraData) == JSON.stringify(AI.extraData))
        return obj

    console.debug("Monitored object changed")
    console.debug("original: ", obj)
    console.debug("changed: ", AI)

    events.emit(obj, obj)

    return obj
}

new PerformanceObserver(_ => {
    console.debug("GC Triggered")
    for (const key in map) {
        if(map[key].deref() == undefined)
            delete map[key]
    }
}).observe({ entryTypes: ['gc'] })

xtHandler.on("earlyLoad", () =>
    sendXT("sce", "{}"))

xtHandler.on("sce", (obj) => {
    obj.forEach(e => {
        let type = e[0]
        let ammount = e[1]
        if (skips[type] == undefined)
            return

        skips[type] = ammount
    })
})

const spendSkip = time => {
    time = (Math.max(time, 60 * 60)) / 60
    let skip = Object.entries(skips)
        .filter(e => e[1] > 0)
        .filter(e => MinuteSkipType[e[0]] <= time * 2)
        .sort((a, b) => MinuteSkipType[b[0]] - MinuteSkipType[a[0]])
        .sort((a, b) => {
            if (a[1] >= 999 && b[1] >= 999)
                return 0
            if (MinuteSkipType[a[0]] > time || MinuteSkipType[b[0]] > time)
                return 0

            if (a[1] >= 999)
                return -1
            if (b[1] >= 999)
                return 1
        })

    if (skip[0] == undefined) {
        console.warn("noMoreSkips")
        console.warn(JSON.stringify(skips))
        return undefined
    }

    console.debug("usingSkip", skip[0][0])

    return skip[0][0]
}

const KingdomSkipType = Object.freeze({
    sendResource: 2,
    sendTroops: 1,

    1: "sendTroops",
    2: "sendResource"
});
const KingdomID = Object.freeze({
    greatEmpire: 0,
    burningSands: 1,
    everWinterGlacier: 2,
    firePeaks: 3,
    stormIslands: 4,
    berimond: 10,

    0: "Great Empire",
    1: "Burning Sands",
    2: "EverWinter Glacier",
    3: "Fire Peaks",
    4: "Storm Islands",
    10: "Berimond"
});
const OwnedCastlePositionList = o =>
    ({ kingdomID: o[0], areaID: o[1], X: o[2], Y: o[3], areaType: o[4] })

const Crest = o => ({
    backgroundType: Number(o.BGT),
    backgroundColor1: Number(o.BGC1),
    backgroundColor2: Number(o.BGC2),
    symbolPositionType: Number(o.SPT),
    symbolType: Number(o.S1),
    symbolColor1: Number(o.SC1),
    symbolType: Number(o.S2),
    symbolColor2: Number(o.SC2),
    isSet: Boolean(o.IS)
})
const AllianceCrest = o => (o ? {
    layoutID: Number(o.ACCA ? o.ACCA.ACLI : o.ACFB?.ACLI),
    colorID: Array.from(o.ACCA ? o.ACCA.ACCS : o.ACFB?.ACCS).map(Number)
} : undefined)
class GAAAreaInfo {
    constructor(o) {
        this.type = Number(o[0])
        this.x = Number(o[1])
        this.y = Number(o[2])
        this.extraData = Array.from(o).toSpliced(0, 3)
        this.timeSinceRequest = Number(Date.now())
    }
}
const FactionData = o => (o ? {
    mainCampID: Number(o.MC),
    factionID: Number(o.FID),
    factionTitleID: Number(o.TID),
    remainingNoobTime: Number(o.NS),
    protectionStatus: Number(o.PMS),
    protectionTime: Number(o.PMT),
    specialCampID: Number(o.SPC)
} : undefined)

const ServerUserAttackProtection = o => ({
    kingdomID: Number(o?.KID),
    remainingNoobTime: Number(o?.NS),
    factionProtectionStatus: Number(o?.PMS),
    factionProtectionEndTime: Number(o?.PMT)
})

const OwnerInfo = o => ({
    ownerID: Number(o.OID),
    isDummy: Boolean(o.DUM),
    name: String(o.N),
    crest: o.E ? Crest(o.E) : void 0,
    level: Number(o.L),
    legendaryLevel: Number(o.LL),
    honour: Number(o.H),
    achievementPoints: Number(o.AVP),
    gloryPoints: Number(o.CF),
    highestGloryPoints: Number(o.HF),
    titlePrefix: Number(o.PRE), //grab items/CastleTitleData.json
    titleSuffix: Number(o.SUF),
    TOPX: Number(o.TOPX), //Unknown property
    mightPoints: Number(o.MP),
    isRuin: Boolean(o.R),
    allianceID: Number(o.AID),
    allianceRank: async () => {
        const allianceRankInfo = JSON.parse(await fs.readFile("./items/allianceranks.json", { encoding: 'utf8' })).find(e => e.rankID == o.AR)
        return String(allianceRankInfo.rankRightName ? allianceRankInfo.rankRightName.replace("RANK_", "") : "UNRANKED")
    },
    allianceName: String(o.AN),
    allianceEmblem: AllianceCrest(o.aee),
    remainingPeaceTime: Number(o.RPT),
    castlePositionList: o.AP ? Array.from(o.AP).map(OwnedCastlePositionList) : undefined,
    villagePositionList: o.VP ? Array.from(o.VP).map(OwnedCastlePositionList) : undefined,
    isSearchingForAlliance: Boolean(o.SA),
    hasPremiumFlag: Boolean(o.PF),
    remainingRelocationTime: Number(o.RRD),
    islandTitleID: Number(o.TI),//grab items/CastleTitleData.json?
    remainingNoobTime: Number(o.RNP),
    factionID: FactionData(o.FN),
})

class ServerGetAreaInfo {
    constructor(o) {
        this.kingdomID = Number(o?.KID)
        this.userAttackProtection = ServerUserAttackProtection(o?.uap)
        this.ownerInfo = o?.OI ? Array.from(o.OI).map(OwnerInfo) : undefined
        this.areaInfo = o?.AI ? Array.from(o?.AI).map(o => MapObject(new GAAAreaInfo(o), this.kingdomID)) : undefined
        this.result = Number(o.result)
    }
}
/**
 * 
 * @param {Number} x 
 * @param {Number} y 
 * @param {Number} kingdomID
 */
const clientPreSpyInfo = (x, y, kingdomID) => {
    /** @type {GAAAreaInfo} */
    const cachedMapData = map[`${kingdomID}_${x}_${y}`]?.deref()
    if((Date.now() - cachedMapData?.timeSinceRequest) <= 1000 * 10) {
        console.debug("Using cached results")
        return async () => ({areaInfo: cachedMapData, result: 0})
    }
    sendXT("ssi", JSON.stringify({ TX: x, TY: y, KID: kingdomID }))
    
    return async () => {
        const [obj, result] = await waitForResult("ssi", 1000 * 10, (obj, result) => 
            result != 0 || 
            obj?.gaa?.KID == kingdomID && 
            obj?.TX == x && 
            obj?.TY == y)

        if(result != 0)
            return {areaInfo: undefined, result : result}

        return {
            areaInfo: new ServerGetAreaInfo(obj.gaa, result).areaInfo[0], 
            result
        }
    }
}

const limiter = new RateLimiter({ tokensPerInterval: 5, interval: "second" });

/**
 * This will give you at max a 100x100 chunk of the map
*/
const clientGetAreaInfo = (kingdomID, fromX, fromY, toX, toY) => {
    const waitObject = limiter.removeTokens(1).then(() => areaInfoLock(() => 
        sendXT("gaa", JSON.stringify({
            KID: Number(kingdomID),
            AX1: Number(fromX),
            AY1: Number(fromY),
            AX2: Number(toX),
            AY2: Number(toY)
        })))).then(() => {
        return waitForResult("gaa", 1000 * 10, (obj, result) => {
            if (Number(result) != 0)
                return true

            if (obj.KID != kingdomID)
                return false

            let ai = obj.AI[0]
            if (ai == undefined)
                return false

            let x = ai[1]
            let y = ai[2]

            let startX = fromX < toX ? fromX : toX
            let startY = fromY < toY ? fromY : toY
            let endX = fromX >= toX ? fromX : toX
            let endY = fromY >= toY ? fromY : toY

            if (x < startX || x > endX ||
                y < startY || y > endY)
                return false
            
            return true
        })
    })
    return async () => {
        const [gaa, result] = await waitObject
        
        gaa.result = result
        return new ServerGetAreaInfo(gaa)
    }
}

const clientGetAllianceInfluence = (allianceID) => {
    sendXT("gabgap", JSON.stringify({ AID: allianceID }))
    const waitObject = waitForResult("gabgap", 1000 * 10, (obj, result) => {
            if (result != 0)
                return false
            if (obj.AID != allianceID)
                false
            return true
        })
    return async () => {
        const [obj, result] = await waitObject

        return { ammount: Number(obj.AMT), result: result }
    }
}
const clientGetPlayerInfluence = (playerID, influence) => {
    let command = "gabgpp"
    if (influence)
        command = "tpc"
    sendXT(command, JSON.stringify({ PID: playerID }))
    const waitObject = waitForResult(command, 1000 * 10, (obj, result) => {
            if (result != 0)
                return false
            if (obj.PID != playerID)
                false
            return true
        })
    return async () => {
        const [obj, result] = await waitObject

        return { ammount: influence ? Number(obj.CCA) : Number(obj.AMT), result: result }
    }
}

const clientGetPlayerEventPoints = (playerID) => {
    sendXT("pcc", JSON.stringify({ PID: playerID }))
    
    const waitObject = waitForResult("pcc", 1000 * 10, (obj, result) => {
            if (result != 0)
                return false
            if (obj.PID != playerID)
                false

            return true
        })

    return async () => {
        const [obj, result] = await waitObject

        return { ammount: Number(obj.CCA), result: result }
    }
}
const StormInfo = e => ({
    currentAllianceStormRank: Number(e.AR),
    isStormKing: Boolean(e.KA),
    allianceEnteredStorm: Boolean(e.AE),
    currentPlayerStormRank: Number(e.IR),
    playerAquaPoints: Number(e.AP),
    result: Number(e.result)
})
const clientGetStormIslandInfo = () => {
    sendXT("ssi", JSON.stringify({}))
    const waitObject = waitForResult("ssi", 1000 * 10)
    return async () => {
        const [obj, result] = await waitObject

        return StormInfo({ ...obj, result: result })
    }
}
const AquaPlayerScores = e => ({
    playerID: Number(e[0]),
    playerName: String(e[1]),
    level: Number(e[2]),
    inStorm: Boolean(e[3]),
    allianceRank: async () => {
        const allianceRankInfo = JSON.parse(await fs.readFile("./items/allianceranks.json", { encoding: 'utf8' })).find(a => a.rankID == e[4])
        return String(allianceRankInfo.rankRightName ? allianceRankInfo.rankRightName.replace("RANK_", "") : "UNRANKED")
    }
})
const AlliancePointsList = e => ({
    alliancePlayerScores: Array.from(APH).map(AquaPlayerScores),
    result: Number(e.result)
})
//TODO: Probs best to add a lock or check if one of the users is within the alliance designated
const clientGetAllianceMemberAquaPoints = AID => {
    sendXT("ama", { AID })
    const waitObject = waitForResult("ama", 1000 * 10)
    return async () => {
        const [obj, result] = await waitObject

        return AlliancePointsList({ ...obj, result: result })
    }
}

const GetProductionData = e => ({
    FoodConsumptionRate: Number(e.DFC) / 10,
    MeadConsumptionRate: Number(e.DMEADC) / 10,
    BeefConsumptionRate: Number(e.DBEEFC) / 10,
    deltaWood: Number(e.DW / 10),
    deltaStone: Number(e.DS / 10),
    deltaFood: Number(e.DF / 10),
    deltaCoal: Number(e.DC / 10),
    deltaOil: Number(e.DO / 10),
    deltaGlass: Number(e.DG / 10),
    deltaAqua: Number(e.DA / 10),
    deltaIron: Number(e.DI / 10),
    deltaHoney: Number(e.DHONEY / 10),
    deltaMead: Number(e.DMEAD / 10),
    deltaBeef: Number(e.DBEEF / 10),

    sickness: Number(e.S), //Old burnt building alternative? Might be connected to riot

    boostWood: Number(e.WM / 100),
    boostStone: Number(e.SM / 100),
    boostFood: Number(e.FM / 100),
    boostCoal: Number(e.CM / 100),
    boostoil: Number(e.OM / 100),
    boostGlass: Number(e.GM / 100),
    boostAqua: Number(e.AM / 100),
    boostIron: Number(e.IM / 100),
    boostHoney: Number(e.HONEYM / 100),
    boostMead: Number(e.MEADM / 100),
    boostBeef: Number(e.BEEFM / 100),

    metroBoost: Number(e.MP ? e.MP : 0),

    foodConsumptionReductionPercentage: Number(e.FCR / 100),
    meadConsumptionReductionPercentage: Number(e.MEADCR / 100),
    beefConsumptionReductionPercentage: Number(e.BEEFCR / 100),

    maxAmmountFood: Number(e.MRF),
    maxAmmountStone: Number(e.MRS),
    maxAmmountWood: Number(e.MRF),
    maxAmmountCoal: Number(e.MRC),
    maxAmmountIron: Number(e.MRI),
    maxAmmountOil: Number(e.MRO),
    maxAmmountGlass: Number(e.MRG),
    maxAmmountMead: Number(e.MRMEAD),
    maxAmmountHoney: Number(e.MRHONEY),
    maxAmmountBeef: Number(e.MRBEEF),
    maxAmmountAqua: Number(e.MRA),

    safeFood: Number(e.SAFE_F),
    safeStone: Number(e.SAFE_S),
    safeWood: Number(e.SAFE_F),
    safeCoal: Number(e.SAFE_C),
    safeIron: Number(e.SAFE_I),
    safeOil: Number(e.SAFE_O),
    safeGlass: Number(e.SAFE_G),
    safeMead: Number(e.SAFE_MEAD),
    safeHoney: Number(e.SAFE_HONEY),
    safeBeef: Number(e.SAFE_BEEF),
    safeAqua: Number(e.SAFE_A),

    population: Number(e.P),
    decorationPoints: Number(e.NDP),
    decorationPointsReduction: Number(e.R),
    guardCount: Number(e.GRD),
    soldierProductionSpeed: Number(e.RS1),
    offensiveToolProductionSpeed: Number(e.RS2),
    defensiveToolProductionSpeed: Number(e.RS3),
    hospitalProductionSpeed: Number(e.RSH),
    buildSpeedBoost: Number(e.BDB) / 100, //Could be an issue float point integer
    //Beri or other sea event
    maxUnitStorage: Number(e.US),
    hasRoyalCaptialBuff: Boolean(e.RCP),
    maxAuxilariesTroops: Number(e.AUS),
    morality: Number(e.M),
    factionBuff: Number(e.RFPPA)
})

const Unit = e => ({
    unitID: Number(e[0]),
    ammount: Number(e[1])
})

const UnitInventory = e => ({
    unitInventory: Array.from(e.I).map(Unit),
    strongHoldInventory: Array.from(e.SHI).map(Unit),
    hospitalInventory: Array.from(e.HI).map(Unit)
})
const DCLAreaInfo = e => ({
    areaID: Number(e.AID),
    wood: Number(e.W),
    stone: Number(e.S),
    food: Number(e.F),
    coal: Number(e.C),
    oil: Number(e.O),
    glass: Number(e.G),
    iron: Number(e.I),
    honey: Number(e.HONEY),
    mead: Number(e.MEAD),
    aqua: Number(e.A),
    defence: Number(e.D),
    getProductionData: GetProductionData(e.gpa),
    unitInventory: Array.from(e.AC ?? []).map(Unit),
    strongHoldInventory: Array.from(e.SHI ?? []).map(Unit),
    hospitalInventory: Array.from(e.HI ?? []).map(Unit),
    travelingUnits: Array.from(e.TU ?? []).map(Unit), //TODO: check that this is valid
    marketCarriagesCount: Number(e.MC ?? []),
    hasBarracks: Boolean(e.B),
    hasSiegeWorkshop: Boolean(e.WS),
    hasDefenseWorkshop: Boolean(e.DW),
    hasHospital: Boolean(e.H),
    openGateTime: Number(e.OGT)
})

// const allianceHelpRequest = e => ({
//     confirmed: Boolean(e.AC),
//     listID: Integer(e.LID),
//     playerName: String(e.PN),
//     progress: Integer(e.P),
//     playerID: Integer(e.PID),
//     requestTypeId: Integer(e.TID),
//     optionalParamsID: Integer(e.OP),
//     remainingTime: Integer(e.RT)
// })

const DclCastleList = e => ({
    kingdomID: Number(e.KID),
    areaInfo: Array.from(e.AI).map(DCLAreaInfo)
})
const DetailedCastleList = e => ({
    playerID: Number(e.PID),
    castles: Array.from(e.C).map(DclCastleList),
    result: Number(e.result)
})
const clientGetDetailedCastleList = async () => {
    let waitObject
    let attemptsLeft = 5
    do {
        sendXT("dcl", JSON.stringify({ CD: 1 }))
        try {
            waitObject = waitForResult("dcl", 1000 * 60)
        }
        catch(e) {
            if (attemptsLeft-- <= 0)
                throw e
            continue
        }
        break
    } while (true)

    const [obj, result] = await waitObject
    return DetailedCastleList({ ...obj, result: result })
}

const clientGetUnitInventory = () => {
    sendXT("gui", JSON.stringify({}))
    const waitObject = waitForResult("gui", 1000 * 10)
    return async () => {
        let [obj, result] = await waitObject

        return UnitInventory({ ...obj, result: result })
    }
}
const UnlockInfo = e => ({
    kingdomID: Number(e.KID),
    isUnlocked: Boolean(e.U),
    hasContor: Boolean(e.C),
    slumLevel: Number(e.SL),
    kingdomResource: Number(e.KRS), //Probs relating to storm
    eventRewardsEndID: Number(e.CRS), //Probs relating to storm rewards
})
const UnitTransferResource = e => ({
    type: String(e[0]),
    count: Number(e[1])
})
const ResourceTransfer = e => ({
    kingdomID: Number(e.KID),
    remainingTime: Number(e.RS),
    resources: Array.from(e.G).map(UnitTransferResource)
})
const TroopTransfer = e => ({
    kingdomID: Number(e.KID),
    remainingTime: Number(e.RS),
    units: Array.from(e.I).map(UnitTransferResource)
})
const KingdomInfo = e => ({ //KPI
    unlockInfo: Array.from(e.UL ?? []).map(UnlockInfo),
    resourceTransferList: Array.from(e.RT ?? []).map(ResourceTransfer),
    troopTransferList: Array.from(e.UT ?? []).map(TroopTransfer),
    result: Number(0)
})
//TODO: May Conflict with other clientGetKingdomInfo
const clientGetKingdomInfo = (sourceAreaID, sourceKingdomID, targetKingdomID, resources) => {
    sendXT("kgt", JSON.stringify({ SCID: sourceAreaID, SKID: sourceKingdomID, TKID: targetKingdomID, G: resources }))

    const waitObject = waitForResult("kgt", 1000 * 10)

    return async () => {
        const [obj, result] = await waitObject

        return KingdomInfo({ ...obj.kpi, result: result })
    }
}
const SubActiveQuests = e => ({
    playerID: Number(e.PID),
    playerName: String(e.PN),
    questID: Number(e.QID),
    questList: Array.from(e.QL),
    timeLeft: Number(e.RS)
})

const ActiveQuests = e => ({
    activeParticipants: Number(e.APC),
    activeQuests: Array.from(e.AQS).map(SubActiveQuests),
    result: Number(e.result)
})

const clientActiveQuestList = () => {
    sendXT("aqs", JSON.stringify({}))

    const waitObject = waitForResult("aqs", 1000 * 10)

    return async () => {
        const [obj, result] = await waitObject

        return ActiveQuests({ ...obj, result: result })
    }
}

//TODO: May conflict with other clientGetMinuteSkipKingdom
const clientGetMinuteSkipKingdom = (skipType, kingdomID, kingdomSkipType) => {
    sendXT("msk", JSON.stringify({ MST: `${skipType}`, KID: `${kingdomID}`, TT: `${kingdomSkipType}` }))

    const waitObject = waitForResult("msk", 1000 * 10)
    
    return async () => {
        const [obj, result] = await waitObject

        return KingdomInfo({ ...obj.kpi, result: result })
    }
}
const GCLCastles = o => ({
    kingdomID: Number(o.KID),
    areaInfo: Array.from(o.AI).map(e => ({
        ...MapObject(new GAAAreaInfo(e.AI), o.KID),
        abandonOutpostTime: Number(e.AOT),
        abandonOutpostTimeCooldown: Number(e.TA)
    }))
})
// const ResourceCastleList = e => ({
//     playerID: Number(e.PID),
//     castles: Array.from(e.C).map(GCLCastles),
//     result: Number(e.result)
// })
class ResourceCastleList {
    constructor(e) {
        this.playerID = Number(e.PID)
        this.castles = Array.from(e.C).map(GCLCastles)
        this.result = Number(e.result)
    }
}
function isEmpty(obj) {
    for (const prop in obj) {
        if (Object.hasOwn(obj, prop)) {
            return false;
        }
    }

    return true;
}
let _activeEventList = {}

const getEventList = async () => {
    if (!isEmpty(_activeEventList))
        return _activeEventList

    let [obj, result] = await waitForResult("sei", 1000 * 10)

    Object.assign(_activeEventList, { ...obj, result })

    return _activeEventList
}

function setEvent(obj, result) {
    if(result != 0)
        return
    
    obj.E.find(e => {
        if (_activeEventList.E?.find(a => a.EID == e.EID))
            return

        // console.debug(`Event ${e.EID} has started`)
        events.emit("eventStart", e)
    })
    
    _activeEventList.E?.find(e => {
        if (obj.E.find(a => a.EID == e.EID))
            return
        
        // console.debug(`Event ${e.EID} has stopped`)
        events.emit("eventStop", e)
    })
    
    Object.assign(_activeEventList, { ...obj, result })
}

xtHandler.on("fjf", (obj, result) => 
    setEvent(obj.sei, result))
xtHandler.on("sei", setEvent)

let _resourceCastleList = {}
/**
 * @returns {Promise<ResourceCastleList>}
 */
const getResourceCastleList = async () => { //Never got
    if (!isEmpty(_resourceCastleList))
        return _resourceCastleList

    let [obj, result] = await waitForResult("gcl", 1000 * 10)

    Object.assign(_resourceCastleList, new ResourceCastleList({ ...obj, result }))

    return _resourceCastleList
}
xtHandler.on("gcl", (obj, result) =>
    Object.assign(_resourceCastleList, new ResourceCastleList({ ...obj, result })))

xtHandler.on("fjf", (obj, result) =>
    Object.assign(_resourceCastleList, new ResourceCastleList({ ...obj.mir.gcl, result })))

const ResourceList = obj => {
    let resource = {}
    obj.forEach(([type, ammount]) => resource[type] = ammount)
    return resource
}

let _ResourceList = {}

let waitTillLoaded = new Promise(resolve => events.once("load", resolve))

const getResources = async () => { //Never got
    await waitTillLoaded
    if (!isEmpty(_ResourceList))
        return _ResourceList

    let [obj,r] = await waitForResult("sce", 1000 * 10)
    if(r != 0)
        return _ResourceList

    Object.assign(_ResourceList, ResourceList(obj))

    return _ResourceList
}
xtHandler.on("sce", obj =>
    Object.assign(_ResourceList, ResourceList(obj)))

const PermanentCastleData = e => e.map(e => ({
    //Units? : Array.from(U.U).map(Number), 
    //Tools? : Array.from(U.L).map(Number),

    unlockedHorses : Array.from(e.UH).map(Number),
    areaID : Number(e.AID),
    kingdomID : Number(e.KID),
}))

const permanentCastleData = []

const getPermanentCastle = () => PermanentCastleData(permanentCastleData)

xtHandler.on("gpc", obj => {
    obj.A.forEach(e => {
        const castleData = permanentCastleData.find(a => e.AID == a.AID && e.KID == a.KID)
        if(!castleData)
            permanentCastleData.push(e)
        else
            Object.assign(castleData, e)
    })
})

let _kingdomInfoList = {}

const getKingdomInfoList = async () => {
    if (!isEmpty(_kingdomInfoList))
        return KingdomInfo(_kingdomInfoList)

    let [obj, result] = await waitForResult("kpi", 1000 * 10) //TODO: Remove?

    Object.assign(_kingdomInfoList, { ...obj, result })

    return KingdomInfo(_kingdomInfoList)
}
xtHandler.on("kpi", (obj, result) =>
    Object.assign(_kingdomInfoList, { ...obj, result }))
xtHandler.on("fjf", (obj, result) => 
    Object.assign(_kingdomInfoList, { ...obj.kpi, result }))
const Feast = e => ({
    type: Number(e.T),
    deltaTime: Number(e.RT),
    result: Number(e.result)
})
const clientStartFeast = (type, areaID, kingdomID) => {
    sendXT("bfs", JSON.stringify({ T: type, CID: areaID, KID: kingdomID, PO: -1, PWR: 0 }))

    const waitObject = waitForResult("bfs", 1000 * 10)

    return async () => {
        const [obj, result] = await waitObject

        return Feast({ ...obj, result: result })
    }
}
const HighscoreList = e => ({
    score: Number(e[0]),
    ammount: Number(e[1]),
    playerData: OwnerInfo(e[2])
})
const Highscore = e => ({
    eventType: Number(e.LT),
    lootID: Number(e.LID),
    list: Array.from(e.L).map(HighscoreList),
    lootRanking: Number(e.LR),
    searchVariable: String(e.SV),
    rank: Number(e.FR),
    IGH: Number(e.IGH), //TODO: figure this bitch out
    result: Number(e.result)
})


const clientGetHighscore = (LT, LID, SV) => {
    sendXT("hgh", JSON.stringify({ LT, LID, SV: `${SV}` }))

    const waitObject = waitForResult("hgh", 1000 * 10, (obj, result) => {
            if (obj.LT != LT)
                return false
            if (obj.SV != SV)
                return false
            if (obj.LID != LID)
                return false
            return true
        })

    return async () => {
        const [obj, result] = await waitObject

        return Highscore({ ...obj, result: result })
    }
}
const PlayerAlliance = e => ({
    allianceID: Number(e.AID),
    rank : Number(e.R),
    allianceName: String(e.N),
    //??? : Number(e.ACF),
    //??? : Number(e.SA)
})
const Alliance = e => ({
    members: Array.from(e.M).map(OwnerInfo),
    allianceID: Number(e.AID),
    //??? : e.CF,
    mightPoints: Number(e.MP),
    description: String(e.D),
    language: String(e.ALL),
    //??? : Number(e.HP),
    //??? : Number(e.IS),
    //??? : Number(e.IA),
    //??? : Number(e.KA),
    allianceCrest: AllianceCrest(e.aee),
    //??? : Number(e.ACLS)
    //??? : Number(e.ML)
    announcement: String(e.A)
    //??? : Number(e.FR),
    //??? : Number(e.SP),
    //??? : Number(e.AP),
    //??? : Number(e.AW),
    //??? : Number(e.HAMP),
    //??? : Number(e.HF),
    //??? : Number(e.AA),
    //??? : Number(e.RT),
    //??? : Array.from(e.ADL).map(),
    //??? : Array.from(e.ABL).map(),
    //??? : AllianceStorage(e.STO),
    //??? : Object(e.AMI),
    //??? : Object(e.ACA),
    //??? : Object(e.ATC),
    //??? : Object(e.AKT),
    //??? : Object(e.AMO),
    //??? : Array.from(e.ALA).map(),
    //??? : Number(e.MF),
    //??? : Number(e.IF),
    //??? : Number(e.SRFU),
    //??? : Number(e.HRFU),

})
const JoinOpenAlliance = e => ({
    alliance: Alliance(e.A),
    playerAlliance: PlayerAlliance(e.gal)
})

const clientJoinOpenAlliance = AID => {
    sendXT("joa", JSON.stringify({ AID }))

    const waitObject = waitForResult("joa", 1000 * 10, obj => {
            if (obj.gal.AID != AID)
                return false

            return true
        })

    return async () => {
        const [obj, result] = await waitObject

        return JoinOpenAlliance({ ...obj, result: result })
    }
}

const BuildingInfo = o => ({
    wodID: Number(o[0]),
    ownerID: Number(o[1]),
    x: Number(o[2]),
    y: Number(o[3]),
    rotation : Number(o[4]),
    buildTime : Number(o[5]),
    buildingState: Number(o[6]),
    hitPoints : Number(o[7]),
    constructionBoost : Number(o[8]) / 100,
    efficiency: Number(o[9]),
    damageType: Number(o[10]),
    extraData : Array.from(o).toSpliced(0, 11)
})
const CastleArea = (o, KID) => ({
    ownerInfo: OwnerInfo(o.O),
    //??? : Number(e.RAF),
    //??? : Number(e.RAW),
    //??? : Number(e.RAS),
    //??? : Number(e.RAB),
    //??? : Array.from(e.BG).map(),
    buildings : Array.from(o.BD).map(BuildingInfo),
    //??? : Array.from(e.T).map(),
    //??? : Array.from(e.G).map(),
    //??? : Array.from(e.D).map(),
    //??? : Array.from(e.CI).map(),
    areaInfo: MapObject(new GAAAreaInfo(o.A), KID),
    buildingSlots: Array.from(o.scl.OIDL).map(Number)
})
class JoinArea {
    constructor(e) {
        this.kingdomID = Number(e.KID)
        this.type = Number(e.type)
        this.getCastleArea = CastleArea(e.gca, e.KID)
        this.userAttackProtection = ServerUserAttackProtection(e.uap)
        this.areaInfo = DCLAreaInfo((e.grc.gpa ??= e.gpa, e.grc))
        //??? : Number(e.scl.SSC)
        ///??? : csl : {///??? : Number(e.SL)}
    }
}

const clientJoinArea = (x, y, kingdomID) => {
    sendXT("joa", JSON.stringify({ PX: x, PY: y, KID: kingdomID }))

    const waitObject = waitForResult("jaa", 1000 * 10, obj => {
            if (obj.KID != kingdomID)
                return false
            if (obj.gca.A[1] != x)
                return false
            if (obj.gca.A[2] != y)
                return false

            return true
        })

    return async () => {
        let [obj, result] = await waitObject

        return new JoinArea({ ...obj, result: result })
    }
}

const clientJoinCastle = (areaID, kingdomID) => {
    sendXT("jca", JSON.stringify({"CID":areaID,"KID":kingdomID}))

    const waitObject = waitForResult("jaa", 1000 * 10, o => 
        o.grc?.KID == kingdomID && o.grc?.AID == areaID)

    return async () => {
        let [obj, result] = await waitObject

        return new JoinArea({ ...obj, result: result })
    }
}

const SearchPlayerName = e => ({
    x: Number(e.X),
    y: Number(e.Y),
    ...new ServerGetAreaInfo(e.gaa),
    result: Number(e.result)
})
const clientSearchPlayerName = (playerName) => {
    sendXT("wsp", JSON.stringify({ PN: playerName }))

    const waitObject = waitForResult("wsp", 1000 * 10, obj => {
                if (obj.gaa?.OI.find(e => e.N == playerName))
                    return true

                return false
            })

    return async () => {
        try {
            let [obj, result] = await waitObject

            return SearchPlayerName({ ...obj, result: result })
        }
        catch (e) {
            console.warn(e)
            return { result: -1 }
        }
    }
}
const AllianceQuestPlayerScore = e => ({
    playerID: Number(e.PID),
    playerName: String(e.PN),
    level: Number(e.L),
    points: Number(e.OP),
    allianceRank: Number(e.R),
})
const AllianceQuestPointCount = e => ({
    list: Array.from(e.AQPC).map(AllianceQuestPlayerScore),
    result: Number(e.result)
})
const clientAllianceQuestPointCount = () => {
    sendXT("aqpc", JSON.stringify({}))

    const waitObject = waitForResult("aqpc", 1000 * 10)

    return async () => {
        const [obj, result] = await waitObject

        return AllianceQuestPointCount({ ...obj, result: result })
    }
}
//loop:
//Process all GAA requests
//Check for castle requests
//if !castleRequests.length exit
//Process Castle requests
//Check for GAA requests
//if !gaa.length exit

let areaInfoCallbacks = []
let kingdomLockCallbacks = []
let kingdomLockInUse = false
let currentKingdom = { AID: undefined }

let areaInfoLock = callback => new Promise(async (resolve, reject) => {
    if (callback)
        areaInfoCallbacks.push(async () => {
            try {
                currentKingdom.AID = undefined
                resolve(await callback())
            }
            catch (e) {
                console.warn(e)
                reject(e)
            }
        })
    else resolve()

    if(areaInfoCallbacks.length <= 0)
        return

    if (kingdomLockInUse)
        return

    kingdomLockInUse = true
    //Fuck you darren
    // for (let i = areaInfoCallbacks.length - 1; i > 0; i--) {
    //     const j = Math.floor(Math.random() * (i + 1));
    //     [areaInfoCallbacks[i], areaInfoCallbacks[j]] = [areaInfoCallbacks[j], areaInfoCallbacks[i]];
    // }
    do {
        await areaInfoCallbacks.shift()()
    }
    while (areaInfoCallbacks.length > 0);

    kingdomLockInUse = false

    if (kingdomLockCallbacks.length <= 0)
        return

    kingdomLock()
})

let kingdomLock = callback => new Promise(async (resolve, reject) => {
    if (callback)
        kingdomLockCallbacks.push(async () => {
            try {
                resolve(await callback())
            }
            catch (e) {
                reject(e)
            }
        })
    else resolve()

    if(kingdomLockCallbacks.length <= 0)
        return

    if (kingdomLockInUse)
        return

    kingdomLockInUse = true

    do {
        await (kingdomLockCallbacks.shift())()
    }
    while (kingdomLockCallbacks.length > 0);

    kingdomLockInUse = false

    if (areaInfoCallbacks.length <= 0)
        return

    areaInfoLock()
})
//Some calls that are dependant on

const ActualMovement = o => ({
    movementId: Number(o.MID),
    deltaTime: Number(o.PT * 1000 + Date.now()),
    totalTime: Number(o.TT * 1000),
    //??? : Number(e.D),
    targetID: Number(o.TID),
    type: Number(o.T),
    horseType : Number(o.HBW),
    kingdomID: Number(o.KID),
    targetAttack: MapObject(new GAAAreaInfo(o.TA), o.KID),
    sourceID: Number(o.SID),
    ownerID : Number(o.OID),
    sourceAttack: MapObject(new GAAAreaInfo(o.SA), o.KID),
})
//TODO: Name
// const L = e=> ({
//     //??? : Number(e.DLID),
//     //??? : Number(e.GID),
//     //??? : Array.from(e.GEM),
//     //??? : Array.from(e.GASAIDS),
//     //??? : Array.from(e.SIDS),
//     //??? : Array.from(e.AE),

// })
// const UM = e => ({
//     //??? : Number(e.PWD),
//     //??? : Number(e.TWD),
//     //??? : L(e.L),
// })
const ArmyUnitInfo = e => ({ type: Number(e[0]), ammount: Number(e[1]) })
const Army = e => ({
    left: Array.from(e.L).map(ArmyUnitInfo),
    middle: Array.from(e.M).map(ArmyUnitInfo),
    right: Array.from(e.R).map(ArmyUnitInfo),
    courtyard: Array.from(e.RW).map(ArmyUnitInfo),
})
class Lord {
    constructor(e) {
        this.lordID = Number(e.ID)
        // this.??? = Number(e.WID)
        this.lordPosition = Number(e.VIS)
        this.name = String(e.N)
        this.generalID = Number(e.GID)
        this.generalLevel = Number(e.L)
        // this.??? = Number(e.ST)
        // this.??? = Number(e.W)
        // this.??? = Number(e.D)
        // this.??? = Number(e.SPR)
        this.EQ = e.EQ ? Array.from(e.EQ) : undefined
        // this.??? = Array.from(e.GASAIDS)
        // this.??? = Array.from(e.SIDS)
        // this.??? = Array.from(e.AE)
    }
}

const LordMovement = e => ({
    // e.PWD
    // e.TWD
    lord: new Lord(e.L)
})
const Movement = e => e == undefined ? undefined : ({
    movementData: ActualMovement(e.M),
    lordMovement: e.UM ? LordMovement(e.UM) : undefined,
    getArmy: e.GA ? Army(e.GA) : undefined,
    getStation: e.A ? Array.from(e.A).map(Unit) : undefined,
    //??? : Array.from(e.AST),
    //??? : Number(e.ATT),
    //resources : e.G ? Array.from(e.G).map(Resource) : undefined
    //??? : Number(e.S),
})
const GetAllMovements = e => ({
    movements: e.M ? Array.from(e.M).map(Movement) : undefined,
    ownerInfo: e.O ? Array.from(e.O).map(OwnerInfo) : undefined
})
const CRAMovement = e => ({
    movement: Movement(e.AAM),
    ownerInfo: e.O ? Array.from(e.O).map(OwnerInfo) : undefined
})
const ReturningAttack = e => ({
    movement: Movement(e.A),
    ownerInfo: e.O? OwnerInfo(e.O) : undefined
})

const clientGetAllianceByID = AID => {
    sendXT("ain", JSON.stringify({ AID }))

    const waitObject = waitForResult("ain", 1000 * 10, obj =>
            obj?.A.AID == AID)

    return async () => {
        let [obj, result] = await waitObject

        return Alliance({ ...obj.A, result: result })
    }
}

const clientGetAllianceByName = name => {
    sendXT("hgh", JSON.stringify({ "LT": 11, "SV": name }))
    const waitObject = waitForResult("hgh", 1000 * 60 * 5, (obj, result) => {
            if (result != 0)
                return false

            if (obj.LT != 11 || obj.SV.toLowerCase() != name.toLowerCase())
                return false
            return true
        })
    return async () => {
        let [obj, _2] = await waitObject

        let item = obj.L?.find(e => e[2][1].toLowerCase() == name.toLowerCase())
        if (item == undefined) {
            throw Error("ALLIANCE_NOT_FOUND")
        }
        return clientGetAllianceByID(item[2][0])()
    }
}

const getKingdomID = areaInfo => {
    if(areaInfo.type == 2)
        return areaInfo.extraData[3]
    if(areaInfo.type == 11)
        return areaInfo.extraData[4]
    return undefined
}

xtHandler.on("cra", (obj, r) => r == 0 ? CRAMovement(obj) : undefined)
xtHandler.on("cat", (obj, r) => r == 0 ? ReturningAttack(obj) : undefined)
xtHandler.on("gaa", (obj, result) => {
    if(result != 0)
        return

    obj.result = result

    obj.KID ??= getKingdomID(new GAAAreaInfo(obj?.AI[0]))

    return new ServerGetAreaInfo(obj)
})
xtHandler.on("ssi", (obj, r) => r == 0 ? new ServerGetAreaInfo(obj.gaa) : undefined)
xtHandler.on("gam", (obj, r) => r == 0 ? GetAllMovements(obj) : undefined)
xtHandler.on("msd", (obj, r) => {
    if(r != 0)
        return

    const areaInfo = new GAAAreaInfo(obj.AI)

    MapObject(areaInfo, getKingdomID(areaInfo))
})

module.exports = {
    spiralCoordinates,
    ClientCommands: {
        preSpyInfo : clientPreSpyInfo,
        getHighScore: clientGetHighscore,
        getAreaInfo: clientGetAreaInfo,
        startFeast: clientStartFeast,
        getAllianceInfluence: clientGetAllianceInfluence,
        getPlayerInfluence: clientGetPlayerInfluence,
        getStormIslandInfo: clientGetStormIslandInfo,
        getAllianceMemberAquaPoints: clientGetAllianceMemberAquaPoints,
        getDetailedCastleList: clientGetDetailedCastleList,
        getUnitInventory: clientGetUnitInventory,
        getKingdomInfo: clientGetKingdomInfo,
        getMinuteSkipKingdom: clientGetMinuteSkipKingdom,
        activeQuestList: clientActiveQuestList,
        getPlayerEventPoints: clientGetPlayerEventPoints,
        joinArea: clientJoinArea,
        searchPlayerName: clientSearchPlayerName,
        allianceQuestPointCount: clientAllianceQuestPointCount,
        getAllianceByID: clientGetAllianceByID,
        getAllianceByName : clientGetAllianceByName,
        joinCastle: clientJoinCastle
    },
    JoinArea,
    kingdomLock,
    areaInfoLock,
    KingdomID,
    AreaType,
    MinuteSkipType,
    KingdomSkipType,
    spendSkip,
    getResourceCastleList,
    getKingdomInfoList,
    getEventList,
    getPermanentCastle,
    getResources,
    HighscoreType,
    Types: {
        OwnerInfo,
        GetAllMovements,
        CRAMovement,
        ServerGetAreaInfo,
        ReturningAttack,
        Lord,
        GAAAreaInfo,
        Movement,
        KingdomInfo,
        DetailedCastleList
    },
    currentKingdom
}
