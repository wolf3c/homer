const {getDefaultConfig}=require('expo/metro-config');
const path=require('node:path');

const config=getDefaultConfig(__dirname);
config.watchFolders=[...config.watchFolders,path.resolve(__dirname,'../assets/branding/odysseus-20261030')];
config.resolver.nodeModulesPaths=[path.resolve(__dirname,'node_modules'),...(config.resolver.nodeModulesPaths??[])];
module.exports=config;
