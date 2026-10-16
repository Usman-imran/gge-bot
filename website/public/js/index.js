addEventListener("DOMContentLoaded", () =>
  document.getElementById("login-form").addEventListener("submit", login))

function login(event) {
  event.preventDefault()

  const form = document.getElementById("login-form")
  const username = form.querySelector("#username").value.trim()
  const password = form.querySelector("#password").value
  const remember = form.querySelector("#remember-me").checked

  return submitForm(form, "Logging in...", async () => {
    if (!username || !password)
      return "Enter your username and password."

    const json = await postApi({ id: 0, username, password })
    if (json.r != 0)
      return json.error ?? "Login failed."

    saveSession(json.uuid, remember)
    window.location.replace("/index.html")
  })
}
