import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { ClientConfig as HiveSignerOptions } from 'hivesigner/lib/types/client-config.interface.js'
import { LoginOptions, LoginResult, Providers } from './types.js'
import { AppMetaType } from './lib/hiveauth-wrapper.js'

export class Aioha {
  providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
  }
  user?: string
  currentProvider?: Providers

  constructor() {
    this.providers = {}
  }

  async registerKeychain(): Promise<boolean> {
    if (!(await Keychain.isInstalled())) return false
    this.providers.keychain = new Keychain()
    return true
  }

  registerHiveSigner(options: HiveSignerOptions) {
    this.providers.hivesigner = new HiveSigner(options)
  }

  registerHiveAuth(options: AppMetaType) {
    this.providers.hiveauth = new HiveAuth(options)
  }

  /**
   * Get list of registered providers
   * @returns string[]
   */
  getProviders() {
    return Object.keys(this.providers)
  }

  getCurrentProvider() {
    return this.currentProvider
  }

  getCurrentUser() {
    return this.user
  }

  async login(provider: Providers, username: string, options: LoginOptions): Promise<LoginResult> {
    if (!this.providers[provider])
      return {
        success: false,
        error: provider + ' provider is not registered'
      }
    if (!username)
      return {
        success: false,
        error: 'username is required'
      }
    if (typeof options !== 'object')
      return {
        success: false,
        error: 'options are required'
      }
    if (provider === 'keychain' && (!options || !options.keychainAuthType))
      return {
        success: false,
        error: 'keychainAuthType options are required'
      }
    const result = await this.providers[provider]!.login(username, options)
    this.user = username
    this.currentProvider = provider
    return result
  }
}
