import * as React from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import IconButton from '@mui/material/IconButton'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

import { ErrorType, ActionType, LogLevel } from "../types.js"
import { useNotify } from './notify'

const LEVEL_COLORS = {
    [LogLevel.Info]: "#8ab4f8",
    [LogLevel.Warn]: "#fdd663",
    [LogLevel.Error]: "#f28b82"
}

//The server keeps the last 25 lines per account in a ring buffer:
//[entries, nextIndex], entry = [level, parts]. parts[2] is the plugin file.
const toOrderedEntries = ([buffer, nextIndex]) =>
    buffer.slice(nextIndex).concat(buffer.slice(0, nextIndex))
        .filter(Boolean)
        .map(([level, parts]) => ({ level, parts }))

//Attack plugins (plugins/attack/attack*.js) and the shared barron/fortress
//logic they run on (logged as "Barron"/"Fortress")
const isAttackScript = name => /^attack/i.test(name) || /AttackLogic$/.test(name)
const ALL_ATTACKS = "__attacks"

//navigator.clipboard only exists on https/localhost, so plain http (VPS by
//IP) falls back to the old copy command.
const copyText = async text => {
    try {
        await navigator.clipboard.writeText(text)
        return true
    }
    catch {
        const area = document.createElement("textarea")
        area.value = text
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand("copy")
        area.remove()
        return ok
    }
}

export default function LogViewer({ ws, user, open, onClose, __ }) {
    const [entries, setEntries] = React.useState([])
    const [levels, setLevels] = React.useState([LogLevel.Info, LogLevel.Warn, LogLevel.Error])
    const [plugin, setPlugin] = React.useState("")
    const [search, setSearch] = React.useState("")
    const [autoScroll, setAutoScroll] = React.useState(true)
    const listEnd = React.useRef(null)
    const notify = useNotify()
    const fullScreen = useMediaQuery(theme => theme.breakpoints.down('sm'))

    React.useEffect(() => {
        const logGrabber = msg => {
            let [err, action, obj] = JSON.parse(msg.data.toString())

            if (Number(action) !== ActionType.GetLogs || Number(err) !== ErrorType.Success)
                return

            setEntries(toOrderedEntries(obj))
        }
        ws.addEventListener("message", logGrabber)
        return () => ws.removeEventListener("message", logGrabber)
    }, [ws])

    //A different account starts with an empty view
    React.useEffect(() => {
        if (open)
            setEntries([])
    }, [open, user?.id])

    const lines = entries.map(entry => ({
        ...entry,
        plugin: String(entry.parts[2] ?? ""),
        text: entry.parts.map(__).join("")
    }))
    const pluginsInLog = [...new Set(lines.map(line => line.plugin).filter(Boolean))]
    const query = search.trim().toLowerCase()
    const shown = lines.filter(line =>
        levels.includes(line.level) &&
        (!plugin || (plugin === ALL_ATTACKS ? isAttackScript(line.plugin) : line.plugin === plugin)) &&
        (!query || line.text.toLowerCase().includes(query)))

    React.useEffect(() => {
        if (open && autoScroll)
            listEnd.current?.scrollIntoView({ block: "end" })
    }, [open, autoScroll, shown.length, entries])

    const copyShown = async () => {
        const ok = await copyText(shown.map(line => line.text).join("\n"))
        notify(ok ? __("logsCopied", "Logs copied.") : __("logsCopyFailed", "Could not copy the logs."), ok ? "success" : "error")
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen}>
            <DialogTitle sx={{ pr: 6 }}>
                {__("logs")}{user?.name ? ` - ${user.name}` : ""}
                <IconButton aria-label={__("close", "Close")} onClick={onClose}
                    sx={{ position: "absolute", right: 8, top: 8 }}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mb: 1.5 }}>
                    <ToggleButtonGroup size="small" value={levels} onChange={(_, value) => setLevels(value)}
                        aria-label={__("logLevels", "Log levels")}>
                        <ToggleButton value={LogLevel.Info} sx={{ color: LEVEL_COLORS[LogLevel.Info] }}>{__("info", "Info")}</ToggleButton>
                        <ToggleButton value={LogLevel.Warn} sx={{ color: LEVEL_COLORS[LogLevel.Warn] }}>{__("warnings", "Warnings")}</ToggleButton>
                        <ToggleButton value={LogLevel.Error} sx={{ color: LEVEL_COLORS[LogLevel.Error] }}>{__("errors", "Errors")}</ToggleButton>
                    </ToggleButtonGroup>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel id="log-plugin-label">{__("plugin", "Plugin")}</InputLabel>
                        <Select labelId="log-plugin-label" label={__("plugin", "Plugin")} value={plugin}
                            onChange={e => setPlugin(e.target.value)}>
                            <MenuItem value="">{__("allPlugins", "All plugins")}</MenuItem>
                            <MenuItem value={ALL_ATTACKS}>{__("allAttacks", "All attacks")}</MenuItem>
                            {pluginsInLog.map(name => <MenuItem key={name} value={name}>{__(name)}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField size="small" label={__("search", "Search")} value={search}
                        onChange={e => setSearch(e.target.value)} sx={{ flexGrow: 1, minWidth: 140 }} />
                    <FormControlLabel control={<Switch size="small" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />}
                        label={<Typography variant="body2">{__("autoScroll", "Auto-scroll")}</Typography>} />
                    <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyShown} disabled={shown.length === 0}>
                        {__("copy", "Copy")}
                    </Button>
                </Box>
                <Box sx={{
                    fontFamily: "monospace", fontSize: "0.8rem", bgcolor: "#111", borderRadius: 1, p: 1.5,
                    height: fullScreen ? "calc(100vh - 260px)" : "55vh", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word"
                }}>
                    {shown.length === 0 ?
                        <Typography variant="body2" color="text.secondary">
                            {entries.length === 0 ? __("noLogsYet", "No log lines yet.") : __("noLogsMatch", "No log lines match the filters.")}
                        </Typography> :
                        shown.map((line, index) =>
                            <div key={index} style={{ color: LEVEL_COLORS[line.level] ?? "inherit", padding: "1px 0" }}>{line.text}</div>)}
                    <div ref={listEnd} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                    {__("logsLimitHint", "The bot keeps the last 25 lines of each account.")}
                </Typography>
            </DialogContent>
        </Dialog>
    )
}
