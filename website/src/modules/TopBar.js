import * as React from 'react'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import Box from '@mui/material/Box'
import LogoutIcon from '@mui/icons-material/Logout'
import CircleIcon from '@mui/icons-material/Circle'

import settings from '../settings.json'

const LANGUAGES = ['en', 'pl', 'de', 'tr', 'ar', 'cs']

function Language({ languageCode, setLanguage }) {
    const [anchorEl, setAnchorEl] = React.useState(null)
    const open = Boolean(anchorEl)
    const handleClose = () => setAnchorEl(null)

    return (
        <>
            <Button
                id="language-button"
                aria-controls={open ? 'language-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={open ? 'true' : undefined}
                onClick={event => setAnchorEl(event.currentTarget)}
                color="inherit"
            >
                {languageCode ?? "en"}
            </Button>
            <Menu
                id="language-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                slotProps={{ list: { 'aria-labelledby': 'language-button' } }}
            >
                {LANGUAGES.map(code =>
                    <MenuItem key={code} onClick={() => { setLanguage(code); handleClose() }}>{code.toUpperCase()}</MenuItem>)}
            </Menu>
        </>
    )
}

//The page's own address (https://rubymining.tech behind nginx). It is sent
//along as "state" so the server uses exactly the same redirect address,
//Discord refuses the login when the two differ.
const openDiscordLink = channelInfo => {
    const origin = settings.port ?
        `${window.location.protocol}//${window.location.hostname}:${settings.port}` : window.location.origin
    const redirect = encodeURIComponent(`${origin}/discordAuth`)
    window.open(`https://discord.com/oauth2/authorize?client_id=${channelInfo[0]}&permissions=8&response_type=code&redirect_uri=${redirect}&state=${encodeURIComponent(origin)}&integration_type=0&scope=identify+guilds.join+bot`, "_blank")
}

//Only forgets the login in this browser, the account itself stays as it is
const logout = () => {
    document.cookie = "uuid=; path=/; max-age=0"
    window.location.href = "signin.html"
}

export default function TopBar({ connected, channelInfo, setLanguage, languageCode, __ }) {
    return (
        <AppBar position="static" color="default" elevation={1}>
            <Toolbar variant="dense" sx={{ gap: { xs: 0.5, sm: 1 }, px: { xs: 1, sm: 2 } }}>
                <Typography variant="h6" component="div" sx={{ fontSize: "1.05rem", whiteSpace: "nowrap" }}>
                    GGE Bot
                </Typography>
                <Tooltip title={connected ?
                    __("connectedHint", "The dashboard is connected to the bot server.") :
                    __("reconnectingHint", "The bot server cannot be reached, retrying every few seconds.")}>
                    {/* On phones only the colored dot is shown, the tooltip explains it */}
                    <Chip size="small" variant="outlined"
                        color={connected ? "success" : "warning"}
                        icon={<CircleIcon sx={{ fontSize: "0.6rem !important" }} />}
                        label={connected ? __("connected", "Connected") : __("reconnecting", "Reconnecting...")}
                        sx={{ '& .MuiChip-label': { display: { xs: "none", sm: "block" } }, '& .MuiChip-icon': { mx: { xs: "6px", sm: "4px 0 0" } } }} />
                </Tooltip>
                <Box sx={{ flexGrow: 1 }} />
                {/* The server only sends the Discord app id when Discord is set up */}
                {channelInfo?.[0] ?
                    <Button color="inherit" size="small" onClick={() => openDiscordLink(channelInfo)}
                        sx={{ whiteSpace: "nowrap", minWidth: 0 }}>{__("linkDiscord")}</Button> : undefined}
                <Language setLanguage={setLanguage} languageCode={languageCode} />
                <Tooltip title={__("logout", "Log out")}>
                    <IconButton color="inherit" onClick={logout} aria-label={__("logout", "Log out")}>
                        <LogoutIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Toolbar>
        </AppBar>
    )
}
