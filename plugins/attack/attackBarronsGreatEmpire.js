if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            { type: "Label", key: "horseSettings" },
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
                key: "useTimeSkips",
                default: false
            },
            { type: "Label", key: "attackSettings" },
            {
                type: "Checkbox",
                key: "attackLeft",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackMiddle",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackRight",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackCourtyard",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackFromOutpost",
                default: false
            },
            {
                type: "Text",
                key: "commanderWhiteList"
            },
            {
                type: "Text",
                key: "attackWaves"
            }
        ]
    }
const { KingdomID, AreaType } = require('../../protocols.js')
const { botConfig, events } = require("../../ggeBot.js")
const commonAttack = require('./sharedBarronAttackLogic.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

events.on("load", () => commonAttack(AreaType.barron, KingdomID.greatEmpire, pluginOptions))