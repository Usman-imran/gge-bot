const ActionType = Object.freeze({
    GetUUID: 0,
    GetUsers: 1,
    SetUser: 2,
    RemoveUser: 3,
    AddUser: 4,
    GetLogs: 5,
    Reset: 6,
    StatusUser: 7,
    Unknown: 8,
    GetChannels : 18,
    AdminGetUsers: 20,
    AdminSetState: 21,
    AdminRemoveUsers: 22
})
const GetActionTypeName = id => 
    Object.keys(ActionType).find(key => ActionType[key] === id) ?? 
        ActionType.Unknown

const ErrorType = Object.freeze({
    Success: 0,
    UnknownAction: 1,
    Unauthenticated: 2,
    Authentication: 3,
    Generic: 4,
    UnknownError: 5,
})

const GetErrorTypeName = id => 
    Object.keys(ErrorType).find(key => ErrorType[key] === id) ??
        "UnknownError"

const LogLevel = Object.freeze({
    Info: 0,
    Warn: 1,
    Error: 2
})

class User {
    constructor(obj) {
      this.id = Number(obj.id) 
      this.state = Number(obj.state)
      this.name = String(obj.name) 
      this.pass = String(obj.pass ? obj.pass : "")
      this.plugins = obj.plugins
      this.lt = Number(obj.lt)
      this.externalEvent = Boolean(obj?.externalEvent)
      this.server = Number(obj?.server)
    }
  }
export { ActionType, GetActionTypeName, ErrorType, GetErrorTypeName, LogLevel, User }
