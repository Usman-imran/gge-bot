import * as React from 'react'
import Checkbox from '@mui/material/Checkbox'
import TextField from '@mui/material/TextField'
import Paper from '@mui/material/Paper'
import Button from '@mui/material/Button'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

import { ErrorType, ActionType } from "../types.js"
import PluginsTable from './pluginsTable'
import settings from '../settings.json'
import { useNotify } from './notify'

let lang = JSON.parse(await (await fetch(`${window.location.protocol === 'https:' ? "https" : "http"}://${window.location.hostname}:${settings.port ?? window.location.port}/lang.json`)).text())

let servers = new DOMParser()
    .parseFromString(await (await fetch(`${window.location.protocol === 'https:' ? "https" : "http"}://${window.location.hostname}:${settings.port ?? window.location.port}/1.xml`)).text(), "text/xml")
let instances = []
let _instances = servers.getElementsByTagName("instance")

for (var key in _instances) {
    let obj = _instances[key]

    let server, zone, instanceLocaId, instanceName
    
    for (var key2 in obj.childNodes) {
        let obj2 = obj.childNodes[key2]
        
        switch(obj2.nodeName) 
        {
            case "server":
                server = obj2.childNodes[0].nodeValue
                break
            case "zone":
                zone = obj2.childNodes[0].nodeValue
                break
            case "instanceLocaId":
                instanceLocaId = obj2.childNodes[0].nodeValue
                break
            case "instanceName":
                instanceName = obj2.childNodes[0].nodeValue
                break
            default:
        }
    }
    if(instanceLocaId)
        instances.push({id: obj.getAttribute("value"),server,zone,instanceLocaId,instanceName})
}

export default function UserSettings({ __, selectedUser, channels, plugins, ws, closeBackdrop, expectSave }) {
    const notify = useNotify()
    selectedUser.name ??= ""
    selectedUser.plugins ??= {}
    const isNewUser = selectedUser.name === ""
    const [name, setName] = React.useState(selectedUser.name)
    const [pass, setPass] = React.useState("")
    const [server, setServer] = React.useState(selectedUser.server ?? instances[0].id)
    const [externalEvent, setExternalEvent] = React.useState(selectedUser.externalEvent)

    return (
        <div onClick={event => event.stopPropagation()} style={{ width: 'max-content' }}>
            <Paper sx={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: { xs: "96vw", md: "80vw" } }}>
                <Box sx={{ p: 2, flexGrow: 1, overflowY: 'auto' }}>
                    <FormGroup row={true} sx={{ mb: 2, gap: 2}}>
                        <TextField required size="small" label={__("username")} value={name} onChange={e => setName(e.target.value)} disabled={!isNewUser} />
                        <TextField required size="small" label={__("password")} type='password' value={pass} onChange={e => setPass(e.target.value)} />
                        
                        <FormControl size="small" style={{minWidth: "max-content"}}>
                            <InputLabel required id="simple-select-label">{__("server")}</InputLabel>
                            <Select
                                labelId="simple-select-label"
                                id="simple-select"
                                value={server}
                                onChange={(newValue) => setServer(newValue.target.value)}
                            >
                                {
                                    instances.map((server, i) => <MenuItem value={server.id} key={i}>{lang[server.instanceLocaId] + ' ' + server.instanceName}</MenuItem>)
                                }
                            </Select>
                        </FormControl>
                        <FormControlLabel sx={{ m: 0 }} control={<Checkbox size="small" />} checked={externalEvent} onChange={e => setExternalEvent(e.target.checked)} label={<Typography variant="body2">OR/BTH</Typography>} />
                    </FormGroup>
                    <PluginsTable plugins={plugins} userPlugins={selectedUser.plugins} channels={channels}  __={__} />
                </Box>
                
                <Box sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', bgcolor: 'background.paper' }}>
                    <Button variant="contained" color="primary" size='small'
                        onClick={async () => {
                            let obj = {
                                name: name,
                                pass: pass,
                                server: server,
                                plugins: selectedUser.plugins,
                                externalEvent: externalEvent
                            }
                            if (!isNewUser) {
                                obj.id = selectedUser.id
                                if (pass === "") obj.pass = selectedUser.pass
                            }
                            else if (name.trim() === "" || pass === "")
                                return notify(__("accountDetailsMissing", "Enter the game username and password."), "error")

                            ws.send(JSON.stringify([
                                ErrorType.Success,
                                isNewUser ? ActionType.AddUser : ActionType.SetUser,
                                obj
                            ]))

                            expectSave?.()
                            closeBackdrop()
                        }}
                    >
                        {__("save")}
                    </Button>
                </Box>
            </Paper>
        </div>
    )
}