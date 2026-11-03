// Android 17 gates WebView UDP as well as native local-network sockets.
export async function localNetworkAccess(platform,permissions){
 if(platform.OS!=='android'||Number(platform.Version)<37)return true;
 const permission=permissions.PERMISSIONS.ACCESS_LOCAL_NETWORK;
 if(await permissions.check(permission))return true;
 return await permissions.request(permission,{
  title:'连接你的电脑',message:'Homer 需要本地网络权限，才能直接连接同一 Wi-Fi 下的电脑。',buttonPositive:'继续',buttonNegative:'稍后'
 })===permissions.RESULTS.GRANTED;
}
