import * as React from 'react'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Select from '@mui/material/Select'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import TextField from '@mui/material/TextField'
import FormControlLabel from '@mui/material/FormControlLabel'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import { Container } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'

const isNumberText = value => /^\s*-?\d+(\.\d+)?\s*$/.test(String(value ?? ""))

//Groups come from where the plugin file lives, e.g. plugins/attack/attackKhan
const GROUPS = {
    attack: "Attacks",
    discord: "Discord",
    "plugins-extra": "Extra",
    "plugins-exploits": "Exploits"
}
const pluginGroup = plugin => {
    const parts = String(plugin.filename ?? "").split("/")
    if (parts[0] !== "plugins")
        return parts[0]
    return parts.length > 2 ? parts[1] : "general"
}
const groupLabel = (group, __) => __(`pluginGroup_${group}`, GROUPS[group] ?? (group === "general" ? "General" : group))

function PluginOption({ pluginData, channels, userPlugins: userPlugins, plugin, __ }) {
    const [value, setValue] = React.useState(userPlugins[plugin.key][pluginData.key] ??= pluginData.default)

    const onChange = value => {
        userPlugins[plugin.key][pluginData.key] = value
        setValue(value)
    }
    switch (pluginData.type) {
        case "":
            return <></>
        case "Label":
            return <Typography variant="subtitle2" sx={{ width: '100%', borderBottom: '1px solid rgba(144, 202, 249, 0.3)', pb: 0.2, mb: 0.2, color: '#90caf9', mt: 0.5, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.7rem' }}>{__(pluginData.key)}</Typography>
        case "Text": {
            //Options with a numeric default expect a number. The bot stores
            //them as text, so we only warn and keep sending the text as is.
            const numeric = isNumberText(pluginData.default)
            const invalid = numeric && String(value).trim() !== "" && !isNumberText(value)
            return <TextField
                fullWidth
                label={__(pluginData.key)}
                variant="outlined"
                size="small"

                value={value}
                onChange={e => onChange(e.target.value)}
                error={invalid}
                helperText={invalid ? __("numberExpected", "Enter a number.") : undefined}
                slotProps={numeric ? { htmlInput: { inputMode: "decimal" } } : undefined}
                sx={{ '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiInputLabel-root': { fontSize: '0.75rem' }, my: 0.5 }}
            />
        }
        case "Checkbox":
            return <FormControlLabel
                control={<Checkbox size="small" sx={{ p: 0.5, color: '#90caf9', '&.Mui-checked': { color: '#90caf9' } }} />}
                label={<Typography variant="body2" sx={{ fontSize: '0.75rem' }}>{__(pluginData.key)}</Typography>}
                
                checked={Boolean(value)}
                onChange={(_, newValue) => onChange(newValue)}
                sx={{ mr: 1, ml: 0, '& .MuiFormControlLabel-label': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}
            />
        case "Table":
            const array_chunks = (array, chunk_size) => Array(Math.ceil(array.length / chunk_size)).fill().map((_, index) => index * chunk_size).map(begin => array.slice(begin, begin + chunk_size))
            return <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'rgba(0,0,0,0.1)', mt: 0.5 }}>
                <Table aria-label="simple table" size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            {pluginData.row.map((cRow, i) => <TableCell key={`${cRow}C${i}`} sx={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#ccc', bgcolor: '#333', py: 0.5 }}>{cRow}</TableCell>)}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {
                            array_chunks(pluginData.data, pluginData.row.length).map((e, i) =>
                                <TableRow key={i}>
                                    {
                                        e.map((pluginData, i) =>
                                            <TableCell key={i} sx={{ py: 0.5 }}>
                                                <PluginOption pluginData={pluginData} channels={channels} userPlugins={userPlugins} __={__} plugin={plugin} />
                                            </TableCell>)
                                    }
                                </TableRow>)
                        }
                    </TableBody>
                </Table>
            </TableContainer>
        case "Channel":
            return <FormControl fullWidth size="small" sx={{ my: 0.5 }}>
                <InputLabel sx={{ fontSize: '0.75rem' }}>{__(pluginData.key)}</InputLabel>
                <Select value={value} label={pluginData.key} onChange={(newValue) => onChange(newValue.target.value)} sx={{ fontSize: '0.75rem' }}>
                    {channels?.map((channel, i) => <MenuItem value={channel.id} key={i} sx={{ fontSize: '0.75rem' }}>{channel.name}</MenuItem>)}
                </Select>
            </FormControl>
        case "Select":
            return <FormControl fullWidth size="small" sx={{ my: 0.5 }}>
                <InputLabel sx={{ fontSize: '0.75rem' }}>{__(pluginData.key)}</InputLabel>
                <Select value={value} label={pluginData.key} onChange={(newValue) => onChange(newValue.target.value)} sx={{ fontSize: '0.75rem' }}>
                    {pluginData.selection.map((e, i) => <MenuItem value={i} key={i} sx={{ fontSize: '0.75rem' }}>{e}</MenuItem>)}
                </Select>
            </FormControl>
        case "Slider":
            return <Box sx={{ display: "flex", alignItems: "center", width: '100%', my: 0.5 }}>
                <Typography variant="body2" sx={{ mr: 1, fontSize: '0.75rem' }}>{__(pluginData.key)}</Typography>
                <Slider size="small" sx={{ flexGrow: 1 }} value={value} onChange={(_, newValue) => onChange(newValue)} />
                <Typography variant="body2" sx={{ ml: 1, minWidth: '25px', fontSize: '0.75rem' }}>{`${value}%`}</Typography>
            </Box>
        default:
            return null
    }
}
const PluginOptionContainer = ({ plugin, channels, userPlugins, __ }) => {
    return <><Typography sx={{ width: '100%', pb: 0.2, mb: 0.2, mt: 0.5, fontWeight: 'bold', fontSize: '0.85rem' }}>{__(plugin.key)}</Typography>
        {
            plugin?.pluginOptions?.map((pluginData, index) => 
                <PluginOption pluginData={pluginData} key={`${plugin.key} ${index}`} channels={channels} userPlugins={userPlugins} __={__} plugin={plugin} />)
        }
    </>
    }
function Plugin({ plugin, __, userPlugins, selectedPlugin, setSelectedPlugin, onToggle }) {
    userPlugins[plugin.key] ??= {}
    const [state, setState] = React.useState(userPlugins[plugin.key].state)
    function onClick() {
        if(plugin.pluginOptions?.length > 0)
            setSelectedPlugin(plugin)
    }
    return (
        <TableRow
            sx={ plugin != selectedPlugin ? {
                '&:nth-of-type(odd)': {
                    backgroundColor: 'rgba(255, 255, 255, 0.03)'
                },
                '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)'
                }
                
            }: {
                backgroundColor: "#375377"
            }}>
            <TableCell onClick={onClick} sx={{ fontWeight: 'bold'}}>{__(plugin.key)}</TableCell>
            <TableCell align='right'>
                {!plugin.force ?
                    <Button
                        variant={state ? "contained" : "outlined"}
                        color={state ? "error" : "success"}
                        size="small"
                        sx={{ minWidth: '70px', height: '28px', fontSize: '0.75rem' }}
                        onClick={() => {
                            setState(!state)
                            userPlugins[plugin.key].state = !state
                            onToggle?.()
                        }}>
                        {__(state ? "stop" : "start")}
                    </Button> : <Button
                        size="small"
                        sx={{ minWidth: '70px', height: '28px', fontSize: '0.75rem' }}
                        disabled />
                }
            </TableCell>
        </TableRow>
    )
}
export default function PluginsTable({ __, userPlugins, plugins, channels }) {
    const [selectedPlugin, setSelectedPlugin] = React.useState(undefined) //, maxHeight: "40vh"
    const [search, setSearch] = React.useState("")
    //Re-render the group counts when a plugin is switched on/off
    const [, setToggles] = React.useState(0)
    const onToggle = () => setToggles(n => n + 1)

    const query = search.trim().toLowerCase()
    const matching = plugins.filter(plugin => !query ||
        __(plugin.key).toLowerCase().includes(query) || plugin.key.toLowerCase().includes(query))

    //Keep the server's order inside a group, groups in order of first appearance
    const groups = []
    matching.forEach(plugin => {
        const name = pluginGroup(plugin)
        let group = groups.find(e => e.name === name)
        if (!group)
            groups.push(group = { name, plugins: [] })
        group.plugins.push(plugin)
    })

    return (
        <Paper elevation={3} style={{ minHeight: "45vh", maxHeight: "65vh", backgroundColor: '#131313', display:"flex", flexDirection:"column"}} >
            <Box sx={{ p: 1, borderBottom: "solid #1b1b1b 2px" }}>
                <TextField size="small" fullWidth value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={__("searchPlugins", "Search plugins...")}
                    slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} /> } }} />
            </Box>
            <TableContainer sx={{ scrollbarColor: "#5e6269 #2d2f31"}}>
                <Table aria-label="plugins table" size="small">
                    <TableBody>
                        {groups.length === 0 ?
                            <TableRow><TableCell sx={{ color: "text.secondary" }}>{__("noPluginsMatch", "No plugins match the search.")}</TableCell></TableRow> :
                            groups.map(group => {
                                const enabled = group.plugins.filter(plugin => !plugin.force && userPlugins[plugin.key]?.state).length
                                const switchable = group.plugins.filter(plugin => !plugin.force).length
                                return <React.Fragment key={group.name}>
                                    <TableRow>
                                        <TableCell colSpan={2} sx={{ bgcolor: "#1d1f22", color: "#90caf9", fontWeight: "bold", fontSize: "0.75rem", textTransform: "uppercase", py: 0.75 }}>
                                            {groupLabel(group.name, __)} ({enabled}/{switchable})
                                        </TableCell>
                                    </TableRow>
                                    {group.plugins.map(plugin =>
                                        <Plugin
                                            plugin={plugin}
                                            key={plugin.key}
                                            userPlugins={userPlugins}
                                            __={__}
                                            selectedPlugin={selectedPlugin}
                                            setSelectedPlugin={setSelectedPlugin}
                                            onToggle={onToggle}
                                        />)}
                                </React.Fragment>
                            })}
                    </TableBody>
                </Table>
            </TableContainer>
            <Container sx={{scrollbarColor: "#5e6269 #2d2f31", minWidth:"100%", minHeight: "25vh", maxHeight: "25vh", overflowY:"auto", flex: "0 0 90%", borderTop: "solid #1b1b1b 3px"}}>
                {
                    selectedPlugin ?
                        <PluginOptionContainer userPlugins={userPlugins} channels={channels} __={__} plugin={selectedPlugin} /> :
                        undefined
                }
            </Container>
        </Paper>
    )
}