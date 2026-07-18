const { platform, arch } = process;

let binding;
if (platform === 'darwin' && arch === 'arm64') {
  binding = require('./keychain-native.darwin-arm64.node');
} else {
  throw new Error(`@shellicar/keychain-native: unsupported platform ${platform}-${arch}`);
}

module.exports.readGenericPassword = binding.readGenericPassword;
