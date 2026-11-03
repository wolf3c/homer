import type {Platform,PermissionsAndroid} from 'react-native';
export function localNetworkAccess(platform:Pick<typeof Platform,'OS'|'Version'>,permissions:Pick<typeof PermissionsAndroid,'PERMISSIONS'|'RESULTS'|'check'|'request'>):Promise<boolean>;
