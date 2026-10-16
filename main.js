const path = require('path')
const crypto = require('crypto')
const undici = require('undici')
const fs = require('fs/promises')
const http = require('node:http')
const express = require('express')
const https = require('node:https')
const bodyParser = require('body-parser')
const { WebSocketServer } = require("ws")
const {parseStringPromise} = require('xml2js')
const { DatabaseSync } = require('node:sqlite')
const { Worker } = require('node:worker_threads')
const { Client, Events, GatewayIntentBits, PermissionFlagsBits } = require('discord.js')
const ErrorType = require('./errors.json')
const ActionType = require('./actions.json')

const { I18n } = require('i18n')

const i18n = new I18n({
  locales: ['en', 'de', 'ar', 'fi', 'he', 'hu', 'pl', 'ro', 'tr', 'cs'],
  directory: path.join(__dirname, 'website', 'public', 'locales'),
  updateFiles: false,
})

const clientOptions = { 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildIntegrations,
  ]
}

const client = new Client(clientOptions)

console.info(i18n.__("startBanner"))

const ggeConfigExample = `{
    "webPort" : "3001",
    "fontPath" : "",
    "privateKey" : "",
    "cert" : "",
    "signupToken" : "",
    "discordToken" : "",
    "discordClientId" : "",
    "discordClientSecret" : "",
    "timeoutMultiplier" : 1,
    "debug" : false
}`

const loggedInUsers = {}
const botMap = new Map()

const userDatabase = new DatabaseSync('./user.db', { timeout: 1000 * 60})
userDatabase.exec(
  `CREATE TABLE IF NOT EXISTS "Users" (
	"username"	TEXT NOT NULL UNIQUE,
	"passwordHash" BLOB NOT NULL,
  "passwordSalt" INTEGER NOT NULL,
  "uuid" TEXT UNIQUE,
	"privilege"	INTEGER,
  "discordUserId"	TEXT,
  "discordGuildId" TEXT
)
`)
userDatabase.exec(
  `CREATE TABLE IF NOT EXISTS "SubUsers" (
  "id"	INTEGER,
	"uuid"	TEXT NOT NULL,
	"name"	TEXT NOT NULL,
	"pass"	TEXT NOT NULL,
	"plugins"	TEXT,
	"state"	INTEGER,
  "externalEvent" INTEGER,
	"server"	INTEGER,
  PRIMARY KEY("id" AUTOINCREMENT)
)
`)

class User {
  constructor(obj) {
    if (obj == undefined)
      return
    this.id = Number(obj?.id)
    this.uuid = String(obj?.uuid)
    this.state = Number(obj?.state)
    this.name = String(obj?.name)
    this.pass = String(obj?.pass)
    this.server = Number(obj?.server)
    this.plugins = obj?.plugins ?? {}
    this.externalEvent = Boolean(obj?.externalEvent)
  }
}
const addUser = (uuid, user) => {
  userDatabase.prepare('INSERT INTO SubUsers (uuid, name, pass, plugins, state, externalEvent, server) VALUES(?,?,?,?,?,?,?)')
    .run(uuid, user.name, user.pass, JSON.stringify(user.plugins), 0, Number(user.externalEvent), user.server)
}
const getSpecificUser = (uuid, user) => {
  const row = userDatabase.prepare('Select id, name, plugins, pass, state, externalEvent, server From SubUsers WHERE uuid=? AND id=?')
    .get(uuid, user.id)

  row.plugins = JSON.parse(row.plugins ?? '{}')

  return new User(row)
}
const changeUser = (uuid, user) => {
  if (user.pass == undefined || user.pass === '' || user.pass == "null") {
    userDatabase.prepare('UPDATE SubUsers SET name=?, state=?, plugins=?, externalEvent =?, server=? WHERE uuid=? AND id=?')
      .run(user.name, user.state, JSON.stringify(user.plugins), Number(user.externalEvent), user.server, uuid, user.id)

    const row = userDatabase.prepare('Select id, name, plugins, pass, state, externalEvent, server From SubUsers WHERE uuid=? AND id=?')
      .get(uuid, user.id)

    row.plugins = JSON.parse(row.plugins ?? '{}')

    return new User(row)
  }
  userDatabase.prepare(`UPDATE SubUsers SET name = ?, pass = ?, state = ?, plugins = ?, externalEvent = ?, server = ? WHERE uuid = ? AND id = ?`)
    .run(user.name, user.pass, user.state, JSON.stringify(user.plugins), Number(user.externalEvent), user.server, uuid, user.id)

  const row = userDatabase.prepare("Select id, name, plugins, pass, state, externalEvent, server From SubUsers WHERE uuid=? AND id=?")
    .get(uuid, user.id)
  row.plugins = JSON.parse(row.plugins ?? '{}')

  return new User(row)

}
const removeUser = (uuid, user) => {
  if (uuid === undefined || user.id === undefined)
    return

  userDatabase.prepare('DELETE FROM SubUsers WHERE uuid = ? AND id = ?')
  .run(uuid, user.id)
}
const getUser = uuid => {
  let str = uuid === undefined ? '' : 'Where uuid=?'

  const prep = userDatabase.prepare(`Select id, uuid, name, plugins, pass, state, externalEvent, server From SubUsers ${str}`)
  const rows = uuid ? prep.all(uuid) : prep.all()

  return rows?.map(e => {
    e.plugins = JSON.parse(e.plugins)
    return new User(e)
  })
}

//The game ignores the case of account names: two saved entries for the same
//game account on one server log each other out in a loop.
const sameGameAccount = (a, b) =>
  String(a.name).trim().toLowerCase() == String(b.name).trim().toLowerCase() &&
  Number(a.server) == Number(b.server)

//Another saved entry (under any web login) for the same game account.
//runningOnly: only entries that are set to run or have a live bot.
const findDuplicate = (user, { runningOnly = false } = {}) =>
  getUser().find(other => other.id != user.id && sameGameAccount(other, user) &&
    (!runningOnly || other.state == 1 || botMap.get(other.id) != undefined))

async function start() {
  try {
    await fs.access('./ggeConfig.json')
  }
  catch {
    await fs.writeFile('./ggeConfig.json', ggeConfigExample)
    console.info(i18n.__('ggeConfigGenerated'))
  }
  const ggeConfig = JSON.parse((await fs.readFile('./ggeConfig.json')).toString())

  console.debug = ggeConfig.debug ? console.debug : _ => { }

  ggeConfig.webPort ??= '3001'

  if (ggeConfig.cert)
    await fs.access(ggeConfig.cert)

  if (ggeConfig.privateKey)
    await fs.access(ggeConfig.privateKey)

  let certFound = true
  if (!(ggeConfig.privateKey || ggeConfig.cert)) {
    certFound = false
    if (!ggeConfig.privateKey)
      console.warn(i18n.__("couldntFindPrivateKey"))
    if (!ggeConfig.cert)
      console.warn(i18n.__("couldntFindCertificate"))
  }
  let hasDiscord = true

  if (!ggeConfig.fontPath) {
    try {
      ggeConfig.fontPath ??= 'C:\\Windows\\Fonts\\segoeui.ttf'
      await fs.access(ggeConfig.fontPath)
    }
    catch {
      console.warn(`${i18n.__("couldntAccessFont")} ${ggeConfig.fontPath}`)
    }
  }

  if (!ggeConfig.discordToken || !ggeConfig.discordClientId) {
    console.warn(i18n.__("couldntSetupDiscord"))
    console.warn(i18n.__("configurationsMissing"))
    if (!ggeConfig.discordToken)
      console.warn('discordToken')
    if (!ggeConfig.discordClientId)
      console.warn('discordClientId')

    hasDiscord = false
  }

  let needLang = false
  async function getItemsJSON() {
    const response = await fetch('https://empire-html5.goodgamestudios.com/default/items/ItemsVersion.properties')
    const str = await response.text()

    let str2 = undefined
    try {
      str2 = (await fs.readFile('./ItemsVersion.properties')).toString()
    }
    catch {}

    let needItems = needLang = str != str2
    try {
      await fs.access('./items')
    }
    catch {
      needItems = true
      await fs.mkdir('./items')
    }
    if (needItems) {
      await fs.writeFile('./ItemsVersion.properties', str)

      const response = await fetch(`https://empire-html5.goodgamestudios.com/default/items/items_v${str.match(new RegExp(/(?!.*=).*/))[0]}.json`)
      for (const [key, value] of Object.entries(await response.json())) {
        if (!/^[A-Za-z\_]+$/.test(key))
          continue

        await fs.writeFile(`./items/${key}.json`, JSON.stringify(value))
      }
    }
  }

  async function getLangJSON() {
    try {
      await fs.access('./lang.json')
    }
    catch {
      needLang = true
    }
    //https://empire-html5.goodgamestudios.com/config/languages/version.json
    if (needLang) { // https://empire-html5.goodgamestudios.com/default/config/country/latest/country.xml
      const response = await fetch('https://empire-html5.goodgamestudios.com/config/languages/latest/en.json')
      const str = await response.text()

      await fs.writeFile('./lang.json', str)
    }
  }
  async function getServerXML() {
    try {
      await fs.access('./1.xml')
    }
    catch {
      needLang = true
    }
    if (needLang) {
      const response = await fetch('https://empire-html5.goodgamestudios.com/config/network/1.xml')
      const str = await response.text()

      await fs.writeFile('./1.xml', str)
    }
  }

  await getItemsJSON()
  await getLangJSON()
  await getServerXML()

  const instances = []
  const json = await parseStringPromise((await fs.readFile('./1.xml')).toString())
  
  json.network.instances[0].instance.forEach(e => 
    instances.push({
      gameURL: e.server[0],
      gameServer: e.zone[0],
      gameID: e['$'].value
    }))

  let pluginData = require('./plugins')

  try {
    pluginData.push(...require('./plugins-extra'))
  } catch(e) {
    console.debug(e)
  }
  try {
    pluginData.push(...require('./plugins-exploits'))
  } catch {}

  const plugins = pluginData
    .map(e => new Object({ key: path.basename(e[0]), filename: e[0], description: e[1].description, force: e[1].force, pluginOptions: e[1]?.pluginOptions, hidden: e[1].hidden }))
    .sort((a, b) => (a.force ?? 0) - (b.force ?? 0))

  const loginCheck = uuid => 
    !!userDatabase.prepare('SELECT * FROM Users WHERE uuid = ?').get(uuid ?? "")

  const app = express()
  app.use(bodyParser.urlencoded({ extended: true }))
  app.get('/', (_, res) => res.redirect('/index.html'))

  // app.get('/lang', (_, res) => {

  // })
  app.get('/lang.json', (_, res) => { 
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.sendFile('lang.json', { root: '.' }) 
  })
  app.get('/1.xml', (_, res) => { 
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.sendFile('1.xml', { root: "." }) 
  })
  //Async on purpose: 600000 rounds take about a second and the sync version
  //blocked every running bot while someone logged in.
  const hashPassword = (password, salt) => new Promise((resolve, reject) =>
    crypto.pbkdf2(password, salt, 600000, 64, 'sha256', (e, hash) => e ? reject(e) : resolve(hash)))

  const USERNAME_MIN = 3, USERNAME_MAX = 32, PASSWORD_MIN = 6

  app.post('/api', bodyParser.json(), async (req, res) => {
    const json = req.body ?? {}
    const reply = (id, obj) => res.json({ id, ...obj })
    const fail = (id, error) => reply(id, { r: 1, error })

    //email_name: field name of the old login page, still in browser caches
    const rawUsername = json.username ?? json.email_name
    const username = typeof rawUsername == "string" ? rawUsername.trim() : ""
    const password = typeof json.password == "string" ? json.password : ""

    try {
      if (json.id == 0) { //Login
        if (!username || !password)
          return fail(0, 'Enter your username and password.')

        //Case-insensitive, but an exact match wins for old accounts that
        //only differ in case.
        const row = userDatabase.prepare(
          'SELECT * FROM Users WHERE username = ? COLLATE NOCASE ORDER BY username = ? DESC LIMIT 1')
          .get(username, username)
        if (!row)
          return fail(0, 'Wrong username or password.')

        const hash = await hashPassword(password, row.passwordSalt)
        if (!crypto.timingSafeEqual(hash, Buffer.from(row.passwordHash)))
          return fail(0, 'Wrong username or password.')

        return reply(0, { r: 0, uuid: row.uuid })
      }

      if (json.id == 1) { //Sign up
        if (username.length < USERNAME_MIN || username.length > USERNAME_MAX)
          return fail(1, `Username must be ${USERNAME_MIN} to ${USERNAME_MAX} characters.`)
        if (password.length < PASSWORD_MIN)
          return fail(1, `Password must be at least ${PASSWORD_MIN} characters.`)

        if (userDatabase.prepare('SELECT 1 FROM Users WHERE username = ? COLLATE NOCASE').get(username))
          return fail(1, 'That username is already taken.')

        const salt = crypto.randomBytes(256)
        const passwordHash = await hashPassword(password, salt)
        const uuid = crypto.randomUUID()
        userDatabase.prepare('INSERT INTO Users (username, passwordHash, passwordSalt, uuid) VALUES(?,?,?,?)')
          .run(username, passwordHash, salt, uuid)

        return reply(1, { r: 0, uuid })
      }

      res.status(400)
      return fail(json.id, 'Unknown request.')
    }
    catch (e) {
      console.error(e)
      res.status(500)
      return fail(json.id, 'Server error, please try again.')
    }
  })

  if (hasDiscord) {
    client.login(ggeConfig.discordToken)
    await new Promise(resolve => {
      client.once(Events.ClientReady, () => {
        resolve()
        app.get('/discordAuth', async (request, response) => {
          const tokenResponseData = await undici.request('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
              client_id: ggeConfig.discordClientId,
              client_secret: ggeConfig.discordClientSecret,
              code: request.query.code,
              grant_type: 'authorization_code',
              redirect_uri: `${request.protocol}://${request.hostname}:${ggeConfig.webPort}/discordAuth`,
              scope: 'identify',
            }).toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          })

          const oauthData = await tokenResponseData.body.json()
          const userResult = await undici.request('https://discord.com/api/users/@me', {
            headers: {
              authorization: `${oauthData.token_type} ${oauthData.access_token}`,
            }
          })
          let discordIdentifier = await userResult.body.json()
          let guildId = request.query.guild_id
          if (!discordIdentifier.id)
            return response.send(i18n.__("missingDiscordID"))
          if (!guildId)
            return response.send(i18n.__("missingGuildID"))

          let guild = client.guilds.cache.get(guildId)
          let channelData = guild.channels.cache.map(channel => {
            if (guild.members.me.permissionsIn(channel)
              .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))
              return { id: channel.id, name: channel.name }

            return undefined
          }).filter(e => e !== undefined)
          let uuid = request.headers.cookie.split('; ').find(e => e.startsWith('uuid='))
            .substring(5, Infinity)
          let valid = loginCheck(uuid)
          if (!valid)
            return response.send(i18n.__("uuidInvalid"))

          userDatabase.prepare('UPDATE Users SET discordUserId = ?, discordGuildId = ? WHERE uuid = ?')
              .run(discordIdentifier.id, guildId, uuid)
          
          loggedInUsers[uuid].forEach(o =>
            o.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetChannels, [ggeConfig.discordClientId, channelData]])))
          return response.send('<html><script language="JavaScript" type="text/javascript">window.close()</script><body>Successful</body></html>')
        })
      })
    })
  }

  app.use(express.static('website/build'))

  async function createBot(uuid, user, messageBuffer, messageBufferCount) {
    messageBuffer ??= []
    messageBufferCount ??= 0
    if (user.id && botMap.get(user.id) != undefined)
      throw Error(i18n.__("gameAccountSessionAlreadyInUse"))

    let data = structuredClone(user)

    let discordCreds = uuid => {
      const row = userDatabase.prepare('SELECT * FROM Users WHERE uuid = ?').get(uuid)
      return row ? { discordGuildId: row.discordGuildId, discordUserId: row.discordUserId } : undefined
    }
    const discordData = discordCreds(uuid)
    plugins.forEach(plugin => {
      data.plugins[plugin.key] ??= {}
      if (plugin.force) {
        data.plugins[plugin.key].state = true
      }
      if (data.plugins[plugin.key]?.state) {
        data.plugins[plugin.key].filename = plugin.filename
        plugin.pluginOptions?.forEach(option => {
          let objectValue = data.plugins[plugin.key][option.key]
          if (option.key == undefined || ![, ""].includes(objectValue))
            return

          data.plugins[plugin.key][option.key] = option.default
        })
      }
    })
    const instance = instances.find(e => Number(e.gameID) == data.server)

    data.gameURL ??= instance.gameURL
    data.gameServer ??= instance.gameServer
    data.gameID ??= instance.gameID

    if (user.externalEvent == true) {
      let users = getUser(uuid)
      let bot = users.find(e => user.name == e.id && user.id != e.id && e.state)
      let getExternalEvent = (worker, alreadyStarted) => new Promise(resolve => { //TODO: add timed reject method
        let func = (obj) => {
          if (obj[0] != ActionType.GetExternalEvent)
            return
          resolve(obj[1])
          worker.off('message', func)
        }

        worker.on('message', func)

        if (alreadyStarted)
          return worker.postMessage([ActionType.GetExternalEvent])

        let a = obj => {
          if (obj[0] != ActionType.Started)
            return

          worker.postMessage([ActionType.GetExternalEvent])
          worker.off('message', a)
        }
        worker.on('message', a)
      })

      if (bot) {
        let worker = botMap.get(bot[0].id)

        let data3 = await getExternalEvent(worker, true)

        if (data3.ths.tsid == 24)
          user.gameURL = 'EmpireEx_42'
        
        user.gameServer = 'ep-live-temp1-game.goodgamestudios.com'
        user.tempServerData = data3
      }
      else {
        let data2 = structuredClone(user)

        plugins.forEach(plugin => {
          data2.plugins[plugin.key] ??= {}
          if (plugin.force) {
            data2.plugins[plugin.key].state = true
          }
          if (data2.plugins[plugin.key]?.state) {
            data2.plugins[plugin.key].filename = plugin.filename
            plugin.pluginOptions?.forEach(option => {
              let objectValue = data.plugins[plugin.key][option.key]
              if (option.key == undefined || ![, ""].includes(objectValue))
                return
              
              data2.plugins[plugin.key][option.key] = option.default
            })
          }
        })
        data2.plugins = []
        data2.externalEvent = false

        data2.gameURL ??= instance.gameURL
        data2.gameServer ??= instance.gameServer
        data2.gameID ??= instance.gameID

        const worker = new Worker('./ggeBot.js', { workerData: { ...data2, discordData } })
        worker.messageBuffer = messageBuffer
        worker.messageBufferCount = messageBufferCount
        worker.on('message', async obj => {
          switch (obj[0]) {
            case ActionType.GetLogs:
              if (!uuid)
                break
              worker.messageBuffer[worker.messageBufferCount] = [obj[1], obj[2]]
              worker.messageBufferCount = (worker.messageBufferCount + 1) % 25
              loggedInUsers[uuid]?.forEach(o => {
                if (o.viewedUser == user.id)
                  o.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs,
                  [worker.messageBuffer, worker.messageBufferCount]]))
              })
              break
          }
        })
        let data3 = await getExternalEvent(worker)

        let tempServerEvent = data3.sei.E.find(e => e.EID == 106)
        if (data3.glt.TSIP && data3.glt.TSZ) {
          data.gameURL = `${data3.glt.TSIP}`
          data.gameServer = data3.glt.TSZ
        }
        else if (tempServerEvent?.TSID == 24) {
          data.gameServer = 'EmpireEx_42'
          data.gameURL = 'ep-live-temp1-game.goodgamestudios.com'
        }
        else if (tempServerEvent?.TSID == 21) {
          data.gameServer = 'EmpireEx_42'
          data.gameURL = 'ep-live-temp1-game.goodgamestudios.com'
        }
        else if (data3.sei.E.find(e => e.EID == 113)) {
          data.gameServer = 'EmpireEx_45'
          data.gameURL = 'ep-live-battle1-game.goodgamestudios.com'
        }
        else {
          console.error(i18n.__("failedToJoinEventServer"))
          return await worker.terminate()
        }
        data.tempServerData = data3
        await worker.terminate()
      }
    }

    const worker = new Worker('./ggeBot.js', { workerData: { ...data, discordData } })

    worker.messageBuffer = messageBuffer
    worker.messageBufferCount = messageBufferCount

    if (user.id)
      botMap.set(user.id, worker)

    const onTerminate = () => {
      if (botMap.get(user.id) == worker) {
        botMap.set(user.id, undefined)
        if (getSpecificUser(uuid, user).state == true) {
          console.debug(`[${user.name}] ${i18n.__("restartDelay")}`)
          setTimeout(() => {
             // Re-fetch user state to ensure they didn't turn it off during the 10s wait
             user = getSpecificUser(uuid, user)
             if (user && user.state == true) {
                 createBot(uuid, user, worker.messageBuffer, worker.messageBufferCount)
             } else {
                 console.debug(`[${user.name}] ${i18n.__("restartCanceledReasonBotStoppedByUser")}`)
             }
          }, 10000)
        }
      }
    }

    worker.on('message', obj => {
      switch (obj[0]) {
        case ActionType.KillBot:
          userDatabase.prepare('UPDATE SubUsers SET state = ? WHERE id = ?').run(0, user.id)
          removeBot(user.id)
          
          loggedInUsers[uuid]?.forEach(({ws}) => 
              ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, [getUser(uuid), plugins.filter(e => !e.hidden)]])))
          break
        case ActionType.GetLogs:
            // console.log("logged something")
          worker.messageBuffer[worker.messageBufferCount] = [obj[1],obj[2]]
          worker.messageBufferCount = (worker.messageBufferCount + 1) % 25
          loggedInUsers[uuid]?.forEach(o => 
              o.viewedUser == user.id ? o.ws.send(JSON.stringify([
                ErrorType.Success, 
                ActionType.GetLogs,
                [worker.messageBuffer, worker.messageBufferCount]
              ])) : undefined)
          break
        case ActionType.StatusUser:
          obj[1].id = user.id
          loggedInUsers[uuid]?.forEach(o =>
            o.ws.send(JSON.stringify([ErrorType.Success, ActionType.StatusUser, obj[1]])))
          break
        case ActionType.RemoveUser:
          worker.off('exit', onTerminate)
          removeUser(uuid, user)
          break
        case ActionType.SetUser:
          userDatabase.prepare('UPDATE SubUsers SET pass = ? WHERE uuid = ? AND id = ?')
            .run(obj[1], uuid, user.id)
          break
      }
    })

    worker.on('exit', onTerminate)

    await new Promise(resolve => {
      const func = obj => {
        if (obj[0] != ActionType.Started)
          return
        resolve()
        worker.once('exit', resolve)
        worker.off('message', func)
      }

      worker.on('message', func)
    })

    return worker
  }

  const removeBot = id => {
    const worker = botMap.get(id)

    if (worker == undefined)
      throw i18n.__("noThreadWorker")

    botMap.delete(id)
    worker.terminate()
  }

  const users = getUser()
  const started = []
  for (let i = 0; i < users.length; i++) {
    let user = users[i]
    let keyRemoved = false
    for (const key of Object.keys(user.plugins)) {
      const pluginFile = plugins.find(e => e?.key == key)
      if(pluginFile != undefined)
        continue
      keyRemoved = true
      delete user.plugins[key]
    }

    if(keyRemoved) {
      user = changeUser(user.uuid, user)
    }

    if (user.state != 0) {
      //Saved duplicates from before this check: only the first one runs
      const clash = started.find(other => sameGameAccount(other, user))
      if (clash) {
        console.warn(`[${user.name}] not started: the same game account already runs as "${clash.name}" (id ${clash.id})`)
        continue
      }
      started.push(user)
      createBot(user.uuid, user)
    }
  }

  const wss = new WebSocketServer({ noServer: true })
  const options = {}

  if (certFound) {
    options.key = await fs.readFile(ggeConfig.privateKey, 'utf8')
    options.cert = await fs.readFile(ggeConfig.cert, 'utf8')
  }

  const socket = (certFound ? https : http)
    .createServer(options, app).listen(ggeConfig.webPort)

  socket.on('upgrade', (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, socket =>
      wss.emit('connection', socket, req)))

  wss.addListener('connection', (ws, req) => {
    const refreshUsers = () =>
      ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, [getUser(uuid), plugins.filter(e => !e.hidden)]]))

    let uuid = req.headers.cookie?.split('; ').find(e => e.startsWith('uuid='))?.substring(5, Infinity)

    if (!loginCheck(uuid))
      return ws.send(JSON.stringify([ErrorType.Unauthenticated, ActionType.GetUUID, {}]))

    loggedInUsers[uuid] ??= []
    loggedInUsers[uuid].push({ ws })

    refreshUsers()

    let users = getUser(uuid)
    users.forEach(user => {
      if (user.state != 1)
        return

      let worker = botMap.get(user.id)
      if (worker == undefined)
        return

      worker.postMessage([ActionType.StatusUser])
    })
    if (hasDiscord) {
      const row = userDatabase.prepare('SELECT * FROM Users WHERE uuid = ?').get(uuid)
      try {
        if (!row.discordGuildId)
          throw i18n.__("missingGuildID")
        if (!row.discordUserId)
          throw i18n.__("missingDiscordUserID")

        let guild = client.guilds.cache.get(row.discordGuildId)
        let channelData = guild.channels.cache.map(channel => {
          if (guild.members.me.permissionsIn(channel)
            .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))
            return { id: channel.id, name: channel.name }

          return undefined
        }).filter((e) => e !== undefined)
        ws.send(JSON.stringify([ErrorType.Success, ActionType.GetChannels, [ggeConfig.discordClientId, channelData]]))
      }
      catch (e) {
        ws.send(JSON.stringify([ErrorType.Success, ActionType.GetChannels, 
          [ggeConfig.discordClientId, ggeConfig.discordPort, undefined]]))
        console.error(e)
      }
    }

    ws.addListener('message', async event => {
      let [_, action, obj] = JSON.parse(event.toString())

      switch (action) {
        case ActionType.GetUsers: {
          refreshUsers()
          break
        }
        case ActionType.StatusUser: {
          break
        }
        case ActionType.AddUser: {
          const user = new User(obj)
          if (findDuplicate(user)) {
            ws.send(JSON.stringify([ErrorType.Generic, ActionType.AddUser, { reason: "duplicateGameAccount", name: user.name }]))
            break
          }
          addUser(uuid, user)
          refreshUsers()
          break
        }
        case ActionType.RemoveUser: {
          let lastError = undefined
          for (let i = 0; i < obj.length; i++) {
            const user = obj[i]
            try {
              removeUser(uuid, user)
            }
            catch (e) {
              lastError = e
            }
          }
          if (lastError) {
            console.warn(lastError)
            ws.send(JSON.stringify([ErrorType.Generic, ActionType.RemoveUser, {}]))
          }
          refreshUsers()
          break
        }
        case ActionType.SetUser: {
          //Starting while another entry of the same game account runs
          if (Number(obj?.state) == 1) {
            const stored = getSpecificUser(uuid, new User(obj))
            if (findDuplicate(stored, { runningOnly: true })) {
              ws.send(JSON.stringify([ErrorType.Generic, ActionType.SetUser, { reason: "duplicateGameAccountRunning", name: stored.name }]))
              refreshUsers() //puts the Start button back
              break
            }
          }
          let oldUser = getSpecificUser(uuid, new User(obj))
          let user = changeUser(uuid, new User(obj))
          if (user.state == 0) {
            try {
              removeBot(user.id)
            } catch (e) {
              console.warn(e)
            }
          }
          else {
            let worker = botMap.get(user.id)
            if (worker == undefined)
              worker = await createBot(uuid, user)
            else {
              let restartedUser = false
              for (const [key, value] of Object.entries(oldUser.plugins)) {
                if (user.plugins[key].state == value.state)
                  continue
                restartedUser = true
                removeBot(user.id)
                worker = await createBot(uuid, user, worker.messageBuffer, worker.messageBufferCount)
                break
              }
              if (!restartedUser) {
                let data = structuredClone(user)

                plugins.forEach(plugin => {
                  data.plugins[plugin.key] ??= {}
                  if (plugin.force) {
                    data.plugins[plugin.key].state = true
                  }
                  if (data.plugins[plugin.key]?.state) {
                    data.plugins[plugin.key].filename = plugin.filename
                    plugin.pluginOptions?.forEach(option => {
                      let objectValue = data.plugins[plugin.key][option.key]
                      if (option.key == undefined || ![, ""].includes(objectValue))
                        return

                      data.plugins[plugin.key][option.key] = option.default
                    })
                  }
                })
                worker.postMessage([ActionType.SetPluginOptions, data])
              }
            }
          }
          loggedInUsers[uuid]?.forEach(({ ws }) => 
            ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, [getUser(uuid), plugins.filter(e => !e.hidden)]])))
          break
        }
        case ActionType.GetLogs: {
          if (!obj) {
            loggedInUsers[uuid].find(o => o.ws == ws).viewedUser = undefined
            break
          }
          const user = new User(obj)
          const worker = botMap.get(user.id)

          if (worker == undefined)
            return ws.send(JSON.stringify([ErrorType.Generic, ActionType.GetLogs, {}]))
          
          let loggedInUser = loggedInUsers[uuid].find(obj => obj.ws == ws)
          loggedInUser.viewedUser = user.id
          loggedInUser.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, 
            [worker.messageBuffer, worker.messageBufferCount]]))
          break
        }
        default:
          ws.send(JSON.stringify([ErrorType.UnknownAction, ActionType.Unknown, {}]))
      }
    })
    ws.addListener('close', () => {
      if (!uuid)
        return
      let index = loggedInUsers[uuid].findIndex((obj) => obj.ws == ws)
      if (index == -1)
        throw Error(i18n.__("couldntFindWebClientIndex"))

      loggedInUsers[uuid].splice(index, 1)

      if (loggedInUsers[uuid].length == 0)
        loggedInUsers[uuid] = undefined
    })
  })

  console.info(i18n.__("started"))
}

start()

module.exports = {
  loggedInUsers,
  botMap,
  userDatabase,
  changeUser,
  getUser,
  removeUser
}
