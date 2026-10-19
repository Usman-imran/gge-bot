import ReconnectingWebSocket from "reconnecting-websocket"
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { CircularProgress, Box } from '@mui/material'
import { useCookies } from 'react-cookie'
import * as React from 'react'
import './App.css'
import { ErrorType, GetErrorTypeName, ActionType, User } from "./types.js"
import GGEUserTable from './modules/GGEUsersTable'
import TopBar from './modules/TopBar'
import AdminPanel from './modules/AdminPanel'
import { NotifyProvider, useNotify } from './modules/notify'
import settings from './settings.json'

function GrabAssets() {
  const [cookies, setCookie] = useCookies([])
  const [lang, setLang] = React.useState(false)
  const setLanguage = async lang => {
    setCookie("lang", cookies.lang = lang, { maxAge: 31536000 })

    try {
      const response = await fetch(
        `${window.location.protocol === 'https:' ? "https" : "http"}://${window.location.hostname}:${window.location.port}/locales/${lang}.json`)

      setLang(await response.json())
    }
    catch (e) {
      throw new Error("Failed to load language.\n\n" + e)
    }
  }

  if (lang === false) {
    setLanguage(cookies.lang ?? "en")

    return <CircularProgress style={{
      margin: "0",
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)"
    }} />
  }
  //__(key, fallback): the fallback (English) is used when a language file
  //does not have the key yet. Only a string counts as fallback, because
  //__ is also passed straight to Array.map, which adds the index.
  const __ = (key, fallback) => {
    if (lang[key])
      return lang[key]
    if (typeof fallback === "string")
      return fallback
    console.warn(`[Language] ${key} key not found`)
    return key
  }
  return <ThemeProvider theme={darkTheme}>
    <NotifyProvider>
      <App setLanguage={setLanguage} languageCode={cookies.lang} __={__} />
    </NotifyProvider>
  </ThemeProvider>
}

//Frosted glass over the cover background: every Paper (top bar, tables,
//cards, dialogs, menus) is see-through and blurs what is behind it.
const glass = (alpha, blur) => ({
  backgroundColor: `rgba(20, 22, 30, ${alpha})`,
  backgroundImage: "none", //dark mode adds a lighter gradient per elevation
  backdropFilter: `blur(${blur}px) saturate(140%)`,
  WebkitBackdropFilter: `blur(${blur}px) saturate(140%)`,
  border: "1px solid rgba(255, 255, 255, 0.08)"
})

const darkTheme = createTheme({
  palette: {
    mode: 'dark'
  },
  components: {
    MuiPaper: { styleOverrides: { root: glass(0.55, 14) } },
    //Dialogs and menus sit on top of other panels, a bit more solid reads better
    MuiDialog: { styleOverrides: { paper: glass(0.78, 18) } },
    MuiPopover: { styleOverrides: { paper: glass(0.85, 18) } },
    MuiAppBar: { styleOverrides: { root: { ...glass(0.45, 16), borderWidth: "0 0 1px 0" } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: "rgba(255, 255, 255, 0.08)" } } }
  }
})

//Waiting for the GetUsers answer that follows a save, see expectSave
const SAVE_TIMEOUT_MS = 8000

function App({ setLanguage, languageCode, __ }) {
  const [users, setUsers] = React.useState([])
  const [usersStatus, setUsersStatus] = React.useState({})
  const [plugins, setPlugins] = React.useState([])
  const [channelInfo, setChannelInfo] = React.useState([])
  const [connected, setConnected] = React.useState(false)
  //Only sent by the server to admins, undefined hides the admin panel
  const [adminAccounts, setAdminAccounts] = React.useState(undefined)
  const notify = useNotify()

  //The server has no "saved" answer: after AddUser/SetUser it sends the new
  //user list (GetUsers). The first list after a save confirms it.
  const pendingSave = React.useRef(undefined)
  const expectSave = React.useCallback(() => {
    clearTimeout(pendingSave.current)
    pendingSave.current = setTimeout(() => {
      pendingSave.current = undefined
      notify(__("saveNoAnswer", "No answer from the bot server, the change may not be saved."), "warning")
    }, SAVE_TIMEOUT_MS)
  }, [notify, __])

  //Messages reach these through refs, the socket itself is created once
  const handlers = React.useRef({})
  handlers.current = { notify, __ }

  let ws = React.useMemo(() => {
    const usersStatus = {}
    const ws = new ReconnectingWebSocket(`${window.location.protocol === 'https:' ? "wss" : "ws"}://${window.location.hostname}:${settings.port ?? window.location.port}`, [], { WebSocket: WebSocket, minReconnectionDelay: 3000 })

    ws.addEventListener("open", () => setConnected(true))
    ws.addEventListener("close", () => setConnected(false))

    ws.addEventListener("message", (msg) => {
      let [err, action, obj] = JSON.parse(msg.data.toString())
      const { notify, __ } = handlers.current
      if (err)
        console.error(GetErrorTypeName(err))

      switch (Number(action)) {
        case ActionType.GetUUID:
          if (err === ErrorType.Unauthenticated)
            return window.location.href = "signin.html"
          break
        case ActionType.GetChannels:
          setChannelInfo(obj ?? [])
          break
        case ActionType.GetUsers:
          if (err !== ErrorType.Success)
            return

          setUsers(obj[0].map(e => new User(e)))
          setPlugins(obj[1])

          if (pendingSave.current) {
            clearTimeout(pendingSave.current)
            pendingSave.current = undefined
            notify(__("saved", "Saved."), "success")
          }
          break
        case ActionType.StatusUser:
          usersStatus[obj.id] = obj
          setUsersStatus(structuredClone(usersStatus))
          break
        case ActionType.AddUser:
        case ActionType.SetUser:
          if (err === ErrorType.Success)
            break
          //A refused save is answered, no "no answer" warning afterwards
          clearTimeout(pendingSave.current)
          pendingSave.current = undefined
          notify(obj?.reason === "duplicateGameAccount" ?
            __("duplicateGameAccount", `"${obj.name}" is already added on this server (maybe under another login). Remove the other one first.`) :
            obj?.reason === "duplicateGameAccountRunning" ?
              __("duplicateGameAccountRunning", `"${obj.name}" is already running on this server under another entry. Stop that one first.`) :
              __("saveFailed", "The bot server refused the change."), "error")
          break
        case ActionType.RemoveUser:
          if (err !== ErrorType.Success)
            notify(__("removeFailed", "Some accounts could not be removed."), "error")
          break
        case ActionType.GetLogs:
          if (err !== ErrorType.Success)
            notify(__("logsNotRunning", "This account is not running, so there are no logs yet."), "info")
          break
        case ActionType.AdminGetUsers:
          setAdminAccounts(err === ErrorType.Success && Array.isArray(obj) ? obj : undefined)
          break
        case ActionType.AdminSetState:
          if (err === ErrorType.Success)
            break
          notify(obj?.reason === "duplicateGameAccountRunning" ?
            __("duplicateGameAccountRunning", `"${obj.name}" is already running on this server under another entry. Stop that one first.`) :
            obj?.reason === "notFound" ?
              __("adminNotFound", "That account no longer exists.") :
              __("saveFailed", "The bot server refused the change."), "error")
          break
        default:
          return
      }
    })
    return ws
  }, [])

  return (
    <div className="App">
      {/* From public/, CSS url() would be resolved inside src/ by the build */}
      <div className="app-background" aria-hidden="true"
        style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/cover.jpg)` }} />
      <TopBar connected={connected}
        channelInfo={channelInfo}
        setLanguage={setLanguage}
        languageCode={languageCode}
        __={__} />
      <GGEUserTable ws={ws} plugins={plugins} rows={users} usersStatus={usersStatus} channelInfo={channelInfo} expectSave={expectSave} __={__} />
      {adminAccounts ?
        <Box sx={{ px: { xs: 1, sm: 2 }, pb: 2 }}>
          <AdminPanel ws={ws} accounts={adminAccounts} __={__} />
        </Box> : undefined}
    </div>
  )
}

export default GrabAssets
