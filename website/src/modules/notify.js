import * as React from 'react'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'

//Small popup messages ("Saved.", errors) at the bottom of the page.
//Usage: const notify = useNotify(); notify("Saved.", "success")
const NotifyContext = React.createContext(() => { })

export const useNotify = () => React.useContext(NotifyContext)

export function NotifyProvider({ children }) {
    const [message, setMessage] = React.useState(undefined)
    const [open, setOpen] = React.useState(false)

    const notify = React.useCallback((text, severity = "info") => {
        setMessage({ text, severity, key: Date.now() })
        setOpen(true)
    }, [])

    const close = (_, reason) => {
        if (reason !== "clickaway")
            setOpen(false)
    }

    return <NotifyContext.Provider value={notify}>
        {children}
        <Snackbar key={message?.key} open={open} autoHideDuration={4000} onClose={close}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
            <Alert onClose={close} severity={message?.severity} variant="filled" sx={{ width: "100%" }}>
                {message?.text}
            </Alert>
        </Snackbar>
    </NotifyContext.Provider>
}
