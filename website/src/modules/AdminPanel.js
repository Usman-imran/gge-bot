import * as React from 'react'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import useMediaQuery from '@mui/material/useMediaQuery'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'

import { ErrorType, ActionType } from "../types.js"

//Only shown to logins listed under "admins" in ggeConfig.json,
//the server checks that again for every action.
export default function AdminPanel({ ws, accounts, __ }) {
    const [filter, setFilter] = React.useState("")
    const [toRemove, setToRemove] = React.useState(undefined)
    const phone = useMediaQuery(theme => theme.breakpoints.down("sm"))

    const send = (action, obj) => ws.send(JSON.stringify([ErrorType.Success, action, obj]))
    const setState = (account, state) => send(ActionType.AdminSetState, { id: account.id, state })

    const search = filter.trim().toLowerCase()
    const shown = accounts
        .filter(a => !search || `${a.name} ${a.owner} ${a.serverName ?? a.server}`.toLowerCase().includes(search))
        .sort((a, b) => String(a.owner).localeCompare(String(b.owner)) || String(a.name).localeCompare(String(b.name)))
    const runningCount = accounts.filter(a => Number(a.state) === 1).length

    return <Paper sx={{ mt: 2, p: { xs: 1, sm: 2 }, textAlign: "left", color: "text.primary" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
            <AdminPanelSettingsIcon color="warning" />
            <Typography variant="h6" sx={{ fontSize: "1.05rem" }}>
                {__("adminAllAccounts", "All accounts (admin)")}
            </Typography>
            <Chip size="small" label={`${runningCount} / ${accounts.length} ${__("adminRunning", "running")}`} />
            <Box sx={{ flexGrow: 1 }} />
            <TextField size="small" placeholder={__("adminSearch", "Search account or owner")}
                value={filter} onChange={e => setFilter(e.target.value)} sx={{ minWidth: 200 }} />
            <Tooltip title={__("refresh", "Refresh")}>
                <IconButton onClick={() => send(ActionType.AdminGetUsers)}><RefreshIcon /></IconButton>
            </Tooltip>
        </Box>
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>{__("account", "Account")}</TableCell>
                        <TableCell>{__("owner", "Owner")}</TableCell>
                        <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{__("server", "Server")}</TableCell>
                        <TableCell>{__("status")}</TableCell>
                        <TableCell align="right" />
                    </TableRow>
                </TableHead>
                <TableBody>
                    {shown.map(account => {
                        const on = Number(account.state) === 1
                        return <TableRow key={account.id}>
                            <TableCell sx={{ fontWeight: "bold" }}>{account.name}</TableCell>
                            <TableCell>{account.owner}</TableCell>
                            <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{account.serverName ?? account.server}</TableCell>
                            <TableCell>
                                <Chip size="small" variant="outlined"
                                    color={on ? (account.running ? "success" : "warning") : "default"}
                                    label={on ? (account.running ? __("adminRunningState", "Running") : __("adminStarting", "Starting...")) : __("adminStopped", "Stopped")} />
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                                {phone ?
                                    <Tooltip title={on ? __("stop", "Stop") : __("start", "Start")}>
                                        <IconButton size="small" color={on ? "error" : "success"} onClick={() => setState(account, on ? 0 : 1)}>
                                            {on ? <StopIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                                        </IconButton>
                                    </Tooltip> :
                                    on ?
                                        <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />}
                                            onClick={() => setState(account, 0)}>{__("stop", "Stop")}</Button> :
                                        <Button size="small" color="success" variant="outlined" startIcon={<PlayArrowIcon />}
                                            onClick={() => setState(account, 1)}>{__("start", "Start")}</Button>}
                                <Tooltip title={__("remove", "Remove")}>
                                    <IconButton size="small" onClick={() => setToRemove(account)}><DeleteIcon fontSize="small" /></IconButton>
                                </Tooltip>
                            </TableCell>
                        </TableRow>
                    })}
                    {shown.length === 0 ?
                        <TableRow><TableCell colSpan={5}>
                            <Typography variant="body2" color="text.secondary">{__("adminNoAccounts", "No accounts found.")}</Typography>
                        </TableCell></TableRow> : undefined}
                </TableBody>
            </Table>
        </TableContainer>
        <Dialog open={toRemove !== undefined} onClose={() => setToRemove(undefined)}>
            <DialogTitle>{__("adminRemoveTitle", "Remove this account?")}</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {`"${toRemove?.name}" (${__("owner", "Owner")}: ${toRemove?.owner}) ` +
                        __("adminRemoveText", "will be stopped and removed from the bot. The owner has to add it again to use it.")}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setToRemove(undefined)}>{__("cancel", "Cancel")}</Button>
                <Button color="error" variant="contained" onClick={() => {
                    send(ActionType.AdminRemoveUsers, { ids: [toRemove.id] })
                    setToRemove(undefined)
                }}>{__("remove", "Remove")}</Button>
            </DialogActions>
        </Dialog>
    </Paper>
}
