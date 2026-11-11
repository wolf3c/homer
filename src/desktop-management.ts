// The current product removed the capability/login HTTP surface. Desktop
// startup may inspect its own account internally; it cannot restore that API.
export function desktopManagementAllowed(method:string,_input?:unknown){
 return method==='history.state';
}
