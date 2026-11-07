/**
 * The public half of the key scripts/release.mjs signs latest.json with
 * (scripts/signing-key.mjs made it; the private half lives only on the PC that
 * publishes releases). A manifest from GitHub that this key does not verify is
 * ignored, so a hijacked release account cannot push code to installed apps.
 */
module.exports = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbtvfFz7cL3QrCpFSniTySc7sP2Yi/T9s0swRRO2lgkY=
-----END PUBLIC KEY-----
`
