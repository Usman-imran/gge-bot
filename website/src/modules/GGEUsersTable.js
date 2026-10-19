import * as React from 'react'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Button from '@mui/material/Button'
import Backdrop from '@mui/material/Backdrop'
import Checkbox from '@mui/material/Checkbox'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardActions from '@mui/material/CardActions'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import useMediaQuery from '@mui/material/useMediaQuery'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'

import { ErrorType, ActionType } from "../types.js"
import UserSettings from './userSettings'
import LogViewer from './LogViewer'

//Status values the bot reports (ggeBot.js), in display order
const STATUS_FIELDS = [
    { key: "level", label: "Level", icon: "⭐" },
    { key: "coin", label: "Coins", icon: "💰" },
    { key: "rubies", label: "Rubies", icon: "💎" },
    { key: "food", label: "Food", icon: "🍖" },
    { key: "mead", label: "Mead", icon: "🍯" },
    { key: "aquamarine", label: "Aquamarine", icon: "🌊", langKey: "aqua" }
]

const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const fullNumber = new Intl.NumberFormat()

//Attacks counted by the game against the attack limit, e.g. "⚔️ 12/50"
function AttackChip({ status, __ }) {
    const attacks = Number(status.attacks), limit = Number(status.attackLimit)
    const hasLimit = Number.isFinite(limit) && limit > 0
    const reached = hasLimit && attacks >= limit
    return <Tooltip title={hasLimit ?
        `${__("attacksCounted", "Attacks counted by the game")}: ${attacks} / ${limit}${reached ? ` - ${__("attackLimitReached", "limit reached, attacks paused")}` : ""}` :
        `${__("attacksCounted", "Attacks counted by the game")}: ${attacks}`}>
        <Chip size="small" variant="outlined" color={reached ? "warning" : "default"}
            label={`⚔️ ${attacks}${hasLimit ? `/${limit}` : ""}`} />
    </Tooltip>
}

function StatusChips({ status, __ }) {
    const shown = STATUS_FIELDS.filter(field => status[field.key] !== undefined && status[field.key] !== null)
    const hasAttacks = Number.isFinite(Number(status.attacks)) && status.attacks !== null
    if (shown.length === 0 && !hasAttacks)
        return <Typography variant="body2" color="text.secondary">-</Typography>

    return <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {hasAttacks ? <AttackChip status={status} __={__} /> : undefined}
        {shown.map(field => {
            const value = Number(status[field.key])
            const label = __(field.langKey ?? field.key, field.label)
            return <Tooltip key={field.key} title={`${label}: ${Number.isFinite(value) ? fullNumber.format(value) : status[field.key]}`}>
                <Chip size="small" variant="outlined"
                    label={`${field.icon} ${Number.isFinite(value) ? compactNumber.format(value) : status[field.key]}`} />
            </Tooltip>
        })}
    </Box>
}

function ErrorBadge({ __ }) {
    return <Tooltip title={__("botErrorHint", "The bot stopped after an error. Open Logs to see why.")}>
        <Chip size="small" color="error" icon={<ErrorOutlineIcon />} label={__("error", "Error")} />
    </Tooltip>
}

const enabledPlugins = row => Object.entries(row.plugins ?? {})
    .filter(([_, value]) => Boolean(value.state) === true && Boolean(value.forced) !== true)
    .map(([key]) => key)

function PluginChips({ row, __ }) {
    const names = enabledPlugins(row)
    if (names.length === 0)
        return <Typography variant="body2" color="text.secondary">-</Typography>
    return <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {names.map(name => <Chip key={name} size="small" label={__(name)} />)}
    </Box>
}

//Running state is shown right away and corrected by the next user list
//from the server (a crashed bot comes back as stopped).
function useRunningState(row) {
    const [state, setState] = React.useState(Boolean(row.state))
    React.useEffect(() => setState(Boolean(row.state)), [row])
    return [state, setState]
}

function RowActions({ row, ws, state, setState, onLogs, onSettings, __ }) {
    return <>
        <Button variant="text" size="small" onClick={onLogs}>{__("logs")}</Button>
        <Button variant="text" size="small" onClick={onSettings}>{__("settings")}</Button>
        <Button variant="contained" size="small"
            color={state ? "error" : "success"}
            startIcon={state ? <StopIcon /> : <PlayArrowIcon />}
            onClick={() => {
                row.state = !state
                ws.send(JSON.stringify([ErrorType.Success, ActionType.SetUser, row]))
                setState(!state)
            }}
            sx={{ ml: 1, minWidth: 92 }}>{state ? __("stop") : __("start")}</Button>
    </>
}

function PlayerRow({ row, status, ws, selected, toggleSelected, onLogs, onSettings, __ }) {
    const [state, setState] = useRunningState(row)

    return <TableRow hover selected={selected}
        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
        <TableCell padding="checkbox">
            <Checkbox color="primary" checked={selected} onClick={toggleSelected}
                inputProps={{ 'aria-label': `${__("select", "Select")} ${row.name}` }} />
        </TableCell>
        <TableCell component="th" scope="row">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography fontWeight="bold">{row.name}</Typography>
                {status.hasError ? <ErrorBadge __={__} /> : undefined}
            </Box>
        </TableCell>
        <TableCell sx={{ maxWidth: "25vw" }}><PluginChips row={row} __={__} /></TableCell>
        <TableCell><StatusChips status={status} __={__} /></TableCell>
        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
            <RowActions row={row} ws={ws} state={state} setState={setState} onLogs={onLogs} onSettings={onSettings} __={__} />
        </TableCell>
    </TableRow>
}

function PlayerCard({ row, status, ws, selected, toggleSelected, onLogs, onSettings, __ }) {
    const [state, setState] = useRunningState(row)

    return <Card variant="outlined" sx={{ borderColor: status.hasError ? "error.main" : undefined }}>
        <CardContent sx={{ pb: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
                <Checkbox color="primary" checked={selected} onClick={toggleSelected} sx={{ p: 0.5 }}
                    inputProps={{ 'aria-label': `${__("select", "Select")} ${row.name}` }} />
                <Typography fontWeight="bold">{row.name}</Typography>
                {status.hasError ? <ErrorBadge __={__} /> : undefined}
            </Box>
            <Typography variant="caption" color="text.secondary">{__("status")}</Typography>
            <Box sx={{ mb: 1 }}><StatusChips status={status} __={__} /></Box>
            <Typography variant="caption" color="text.secondary">{__("plugins")}</Typography>
            <PluginChips row={row} __={__} />
        </CardContent>
        <CardActions sx={{ justifyContent: "flex-end", pt: 0 }}>
            <RowActions row={row} ws={ws} state={state} setState={setState} onLogs={onLogs} onSettings={onSettings} __={__} />
        </CardActions>
    </Card>
}

function ConfirmRemove({ open, names, onCancel, onConfirm, __ }) {
    return <Dialog open={open} onClose={onCancel}>
        <DialogTitle>{__("removeConfirmTitle", "Remove accounts?")}</DialogTitle>
        <DialogContent>
            <DialogContentText>
                {__("removeConfirmText", "These accounts and their settings will be deleted from the bot:")}
            </DialogContentText>
            <Box component="ul" sx={{ mt: 1, mb: 0 }}>
                {names.map(name => <li key={name}><Typography fontWeight="bold">{name}</Typography></li>)}
            </Box>
        </DialogContent>
        <DialogActions>
            <Button onClick={onCancel}>{__("cancel", "Cancel")}</Button>
            <Button onClick={onConfirm} color="error" variant="contained" startIcon={<DeleteIcon />}>{__("remove")}</Button>
        </DialogActions>
    </Dialog>
}

function PlayerList({ __, rows, usersStatus, ws, onAdd, onLogs, onSettings }) {
    const [selected, setSelected] = React.useState([])
    const [confirmOpen, setConfirmOpen] = React.useState(false)
    const compact = useMediaQuery(theme => theme.breakpoints.down('md'))

    //Accounts removed elsewhere drop out of the selection
    const selectedRows = rows.filter(row => selected.includes(row.id))
    const allSelected = rows.length > 0 && selectedRows.length === rows.length

    const toggleSelected = id => setSelected(current =>
        current.includes(id) ? current.filter(e => e !== id) : [...current, id])

    const removeSelected = () => {
        ws.send(JSON.stringify([ErrorType.Success, ActionType.RemoveUser, selectedRows]))
        setSelected([])
        setConfirmOpen(false)
    }

    const itemProps = row => ({
        row,
        status: usersStatus[row.id] ?? {},
        ws,
        __,
        selected: selected.includes(row.id),
        toggleSelected: () => toggleSelected(row.id),
        onLogs: () => onLogs(row),
        onSettings: () => onSettings(row)
    })

    //App.css centers everything and the page has no base text color
    return <Box sx={{ p: { xs: 1, sm: 2 }, color: "text.primary", textAlign: "left" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
            {/* Sits straight on the cover image, the shadow keeps it readable */}
            <Typography variant="h6" sx={{ fontSize: "1.05rem", flexGrow: 1, textShadow: "0 1px 4px rgba(0, 0, 0, 0.9)" }}>
                {__("accounts", "Accounts")} ({rows.length})
            </Typography>
            {compact && rows.length > 0 ?
                <Button size="small" onClick={() => setSelected(allSelected ? [] : rows.map(row => row.id))}>
                    {allSelected ? __("selectNone", "Select none") : __("selectAll", "Select all")}
                </Button> : undefined}
            <Button variant="outlined" color="error" size="small" startIcon={<DeleteIcon />}
                disabled={selectedRows.length === 0} onClick={() => setConfirmOpen(true)}>
                {__("remove")}{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
            </Button>
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onAdd}>
                {__("addAccount", "Add account")}
            </Button>
        </Box>

        {rows.length === 0 ?
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
                <Typography color="text.secondary">{__("noAccounts", "No accounts yet. Click \"Add account\" to add your first game account.")}</Typography>
            </Paper> :
            compact ?
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {rows.map(row => <PlayerCard key={row.id} {...itemProps(row)} />)}
                </Box> :
                <TableContainer component={Paper}>
                    <Table aria-label={__("accounts", "Accounts")}>
                        <TableHead>
                            <TableRow>
                                <TableCell padding="checkbox">
                                    <Checkbox color="primary" checked={allSelected}
                                        indeterminate={selectedRows.length > 0 && !allSelected}
                                        onClick={() => setSelected(allSelected ? [] : rows.map(row => row.id))}
                                        inputProps={{ 'aria-label': __("selectAll", "Select all") }} />
                                </TableCell>
                                <TableCell>{__("name")}</TableCell>
                                <TableCell>{__("plugins")}</TableCell>
                                <TableCell>{__("status")}</TableCell>
                                <TableCell />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map(row => <PlayerRow key={row.id} {...itemProps(row)} />)}
                        </TableBody>
                    </Table>
                </TableContainer>}

        <ConfirmRemove open={confirmOpen} names={selectedRows.map(row => row.name)}
            onCancel={() => setConfirmOpen(false)} onConfirm={removeSelected} __={__} />
    </Box>
}

export default function GGEUserTable({ __, rows, usersStatus, ws, channelInfo, plugins, expectSave }) {
    const user = {}

    const [openSettings, setOpenSettings] = React.useState(false)
    const [selectedUser, setSelectedUser] = React.useState(user)
    const [logUser, setLogUser] = React.useState(undefined)

    const handleSettingsClose = () => {
        setOpenSettings(false)
        setSelectedUser(user)
    }

    const openLogs = row => {
        ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, row]))
        setLogUser(row)
    }
    const closeLogs = () => {
        ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, undefined]))
        setLogUser(undefined)
    }

    return (
        <>
            <Backdrop
                sx={theme => ({ color: '#fff', zIndex: theme.zIndex.drawer + 1 })}
                open={openSettings}
                onClick={handleSettingsClose}
                style={{ maxHeight: '100%', overflow: 'auto' }}
                key={selectedUser.id} >
                <UserSettings ws={ws}
                    selectedUser={selectedUser}
                    key={selectedUser.id}
                    closeBackdrop={handleSettingsClose}
                    plugins={plugins}
                    channels={channelInfo[1]}
                    expectSave={expectSave}
                    __={__} />
            </Backdrop>
            <LogViewer ws={ws} user={logUser} open={logUser !== undefined} onClose={closeLogs} __={__} />
            <PlayerList
                __={__}
                rows={rows}
                usersStatus={usersStatus}
                ws={ws}
                onAdd={() => setOpenSettings(true)}
                onLogs={openLogs}
                onSettings={row => {
                    setSelectedUser(row)
                    setOpenSettings(true)
                }}
            />
        </>
    )
}
