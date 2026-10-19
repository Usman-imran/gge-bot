addEventListener("DOMContentLoaded", () => {
    document.getElementById("signup-form").addEventListener("submit", signup)
    showInviteCodeIfRequired()
})

//Same limits as the server (main.js), checked here only for quicker feedback
const USERNAME_MIN = 3, USERNAME_MAX = 32, PASSWORD_MIN = 6

let inviteRequired = false

//The server tells whether an invite code is set ("signupToken" in ggeConfig.json)
async function showInviteCodeIfRequired() {
    const json = await postApi({ id: 2 })
    inviteRequired = json.r == 0 && Boolean(json.inviteRequired)
    document.getElementById("invite-code-row").hidden = !inviteRequired
}

function signup(event) {
    event.preventDefault()

    const form = document.getElementById("signup-form")
    const username = form.querySelector("#username").value.trim()
    const password = form.querySelector("#password").value
    const confirm = form.querySelector("#confirm-password").value
    const inviteCode = form.querySelector("#invite-code").value.trim()

    return submitForm(form, "Creating account...", async () => {
        if (username.length < USERNAME_MIN || username.length > USERNAME_MAX)
            return `Username must be ${USERNAME_MIN} to ${USERNAME_MAX} characters.`
        if (password.length < PASSWORD_MIN)
            return `Password must be at least ${PASSWORD_MIN} characters.`
        if (password != confirm)
            return "The passwords do not match."
        if (inviteRequired && !inviteCode)
            return "Enter the invite code you got from the bot owner."

        const json = await postApi({ id: 1, username, password, inviteCode })
        if (json.r != 0)
            return json.error ?? "Sign up failed."

        //Signed up = logged in, and remembered like "Remember me"
        saveSession(json.uuid, true)
        window.location.replace("/index.html")
    })
}
