//Shared by plugins that have to stand inside a castle (recruiting, building):
//the server checks the castle the bot is in, not the one named in a command.
//Only one plugin moves between castles at a time, and the bot is put back
//into the main castle afterwards.
const { ClientCommands, KingdomID, AreaType, getResourceCastleList } = require("./protocols.js")
const { quietTimeoutKeys } = require("./ggeBot.js")
const err = require("./err.json")

let queue = Promise.resolve()

const getMainCastle = async () => {
    const resourceCastleList = await getResourceCastleList()
    const areaID = Number(resourceCastleList.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
        .areaInfo.find(e => e.type == AreaType.mainCastle)
        .extraData[0])
    return { kingdomID: KingdomID.greatEmpire, areaID }
}

/**
 * Runs fn while holding the castle lock.
 * fn gets enter(castle) -> JoinArea (castle = { kingdomID, areaID }), which
 * throws when the castle cannot be entered.
 */
const visitCastles = fn => {
    const run = queue.then(async () => {
        let joined

        //joinCastle only resolves with the data of exactly this castle and
        //rejects (timeout) otherwise; JoinArea has no result field to check.
        const enter = async castle => {
            let joinArea
            try {
                joinArea = await ClientCommands.joinCastle(castle.areaID, castle.kingdomID)()
            }
            catch (e) {
                throw new Error(`joinCastle ${castle.kingdomID}/${castle.areaID}: ${err[e] ?? e?.message ?? e}`)
            }
            joined = castle
            return joinArea
        }

        //A successful join answers with a bogus "jaa TIMED_OUT" line, hide it
        //while we hop between castles, but only if nobody else asked for that.
        const hideJoinNoise = !quietTimeoutKeys.has("jaa")
        if (hideJoinNoise)
            quietTimeoutKeys.add("jaa")

        try {
            return await fn(enter)
        }
        finally {
            try {
                if (joined) {
                    const main = await getMainCastle()
                    if (joined.kingdomID != main.kingdomID || joined.areaID != main.areaID)
                        await enter(main)
                }
            }
            catch (e) {
                console.warn("returnToMainCastleFailed", e.message ?? e)
            }
            if (hideJoinNoise)
                quietTimeoutKeys.delete("jaa")
        }
    })
    //A failed visit must not block the next one
    queue = run.catch(() => { })
    return run
}

module.exports = { visitCastles }
