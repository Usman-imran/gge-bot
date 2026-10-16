//Shared by signin.html and signup.html

//Relative URL: works on any host/port and behind a reverse proxy
async function postApi(body) {
  let response
  try {
    response = await fetch("/api", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-type": "application/json; charset=UTF-8" }
    })
  }
  catch {
    return { r: 1, error: "Could not reach the bot server. Is it running?" }
  }

  try {
    return await response.json()
  }
  catch {
    return { r: 1, error: `Server error (${response.status}), please try again.` }
  }
}

//Without max-age the session ends when the browser closes
function saveSession(uuid, remember) {
  document.cookie = `uuid=${uuid}; path=/; SameSite=Lax` + (remember ? "; max-age=31536000" : "")
}

//Disables the form while a request runs so double clicks do not send twice
async function submitForm(form, busyText, action) {
  const button = form.querySelector("button[type=submit]")
  const banner = form.querySelector(".login-info-banner")
  const idleText = button.textContent

  banner.textContent = ""
  button.disabled = true
  button.textContent = busyText
  try {
    const error = await action()
    if (error)
      banner.textContent = error
  }
  finally {
    button.disabled = false
    button.textContent = idleText
  }
}
