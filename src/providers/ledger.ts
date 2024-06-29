import type LedgerApp from '@engrave/ledger-app-hive'
import { AiohaProviderBase } from './provider.js'
import { Transaction, Operation } from '@hiveio/dhive'
import { LoginOptions, LoginResult, OperationResult, SignOperationResult, KeyTypes, Providers } from '../types.js'
import { broadcastTx, getKeyRefs } from '../rpc.js'
import { constructTxHeader } from '../opbuilder.js'
import type CryptoJSType from 'crypto-js'
import assert from 'assert'

let CryptoJS: typeof CryptoJSType

const sha256 = (input: string) => {
  return CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex)
}

enum SlipRole {
  owner = 0,
  active = 1,
  memo = 3,
  posting = 4
}

interface DiscoveredAccs {
  username: string
  path: string
  pubkey: string
}

const traverseConfig = {
  maxAccountGap: 2,
  maxKeyGap: 2,
  maxKeySearch: 1024
}

const makePath = (role: SlipRole, accountIdx: number, keyIdx: number) => {
  return `m/48'/13'/${role}'/${accountIdx}'/${keyIdx}'`
}

// https://gitlab.com/engrave/ledger/hiveledger/-/blob/main/src/modules/hive/accountDiscovery/discoverAccounts/discoverAccounts.ts
const searchAccounts = async (role: SlipRole, app: LedgerApp, targetUser?: string, api?: string) => {
  const foundAccounts: DiscoveredAccs[] = []
  outerLoop: for (let accountIndex = 0, accountGap = 0; accountGap < traverseConfig.maxAccountGap; accountIndex++) {
    for (let keyIndex = 0, keyGap = 0; keyGap < traverseConfig.maxKeyGap; keyIndex += 1) {
      const path = makePath(role, accountIndex, keyIndex)
      const pubkey = await app.getPublicKey(path, false)
      const accounts = await getKeyRefs([pubkey], api)
      let accountExists = false
      if (!accounts.error && accounts.result && Array.isArray(accounts.result.accounts))
        for (let i in accounts.result.accounts)
          if (Array.isArray(accounts.result.accounts[i]))
            for (let j in accounts.result.accounts[i]) {
              accountExists = true
              foundAccounts.push({
                username: accounts.result.accounts[i][j],
                path,
                pubkey
              })
              if (targetUser === accounts.result.accounts[i][j]) break outerLoop
            }
      if (accountExists) {
        accountGap = 0
        keyGap = 0
      } else {
        keyGap++
        if (keyGap === traverseConfig.maxKeyGap && keyIndex === traverseConfig.maxKeyGap - 1) {
          accountGap += 1
        }
      }
    }
  }
  return foundAccounts
}

const searchAccountsAllRolesForUser = async (
  app: LedgerApp,
  targetUser: string,
  api?: string
): Promise<DiscoveredAccs | null> => {
  const roles = [SlipRole.owner, SlipRole.active, SlipRole.posting]
  for (let r in roles) {
    const discoveredAccounts = await searchAccounts(roles[r], app, targetUser, api)
    const found = discoveredAccounts.find((a) => a.username === targetUser)
    if (found) return found
  }
  return null
}

const connectionFailedError: SignOperationResult = {
  success: false,
  error: 'Failed to establish connection to the device'
}

export class Ledger extends AiohaProviderBase {
  private path?: string
  private username?: string
  private provider?: LedgerApp

  constructor(api: string) {
    super(api)
  }

  /**
   * Establish connection with the device. To be called every time before any other interaction.
   * @returns Whether the connection has been established successfully or not.
   */
  private async checkConnection(): Promise<boolean> {
    try {
      if (!this.provider) {
        const TransportWebUSB = (await import(/* webpackChunkName: 'ledger' */ '@ledgerhq/hw-transport-webusb')).default
        let LedgerApp = (await import(/* webpackChunkName: 'ledger' */ '@engrave/ledger-app-hive')).default
        //@ts-ignore
        if (typeof LedgerApp.default !== 'undefined' && LedgerApp.__esModule) LedgerApp = LedgerApp.default
        const t = await TransportWebUSB.create()
        this.provider = new LedgerApp(t)
        t.on('disconnect', () => delete this.provider)
      }
      CryptoJS = (await import(/* webpackChunkName: 'cryptojs' */ 'crypto-js')).default
      return true
    } catch {
      return false
    }
  }

  private async closeConnection() {
    if (this.provider) {
      await this.provider.transport.close()
      delete this.provider
    }
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!(await this.checkConnection()))
      return {
        provider: Providers.Ledger,
        ...connectionFailedError
      }
    assert(this.provider)
    try {
      // username check
      try {
        const userFound = await searchAccountsAllRolesForUser(this.provider, username)
        if (!userFound) {
          await this.closeConnection()
          return {
            provider: Providers.Ledger,
            success: false,
            error: 'Username is not associated with the device'
          }
        }
        try {
          // obtain signature
          // message signing is supported as of v1.2.0 however it isn't on ledger live yet :\
          // const signature = await app.signMessage(options.msg ?? 'Aioha app login', userFound.path)
          const signature = await this.provider.signHash(sha256(options.msg ?? 'Aioha app login'), userFound.path)
          this.username = username
          this.path = userFound.path
          localStorage.setItem('ledgerPath', this.path)
          return {
            provider: Providers.Ledger,
            success: true,
            message: 'Message signed successfully',
            result: signature,
            publicKey: userFound.pubkey,
            username
          }
        } catch (e) {
          await this.closeConnection()
          return {
            provider: Providers.Ledger,
            success: false,
            error: (e as any).message ?? 'Failed to obtain message signature'
          }
        }
      } catch {
        await this.closeConnection()
        return {
          provider: Providers.Ledger,
          success: false,
          error: 'Failed to search accounts'
        }
      }
    } catch (e) {
      return {
        provider: Providers.Ledger,
        success: false,
        error: (e as any).message ?? 'Failed to login'
      }
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    return {
      provider: Providers.Ledger,
      success: false,
      error: 'Memo cryptography is not supported in Ledger provider'
    }
  }

  async logout(): Promise<void> {
    try {
      await this.closeConnection()
      delete this.username
      delete this.path
      localStorage.removeItem('ledgerPath')
    } catch {}
  }

  loadAuth(username: string): boolean {
    const path = localStorage.getItem('ledgerPath')
    if (!path) return false
    this.username = username
    this.path = path
    return true
  }

  getUser(): string | undefined {
    return this.username
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    return {
      success: false,
      error: 'Memo cryptography is not supported in Ledger provider'
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!(await this.checkConnection())) return connectionFailedError
    assert(this.provider && this.path)
    try {
      const signature = await this.provider.signHash(sha256(message), this.path)
      return {
        success: true,
        message: 'Message signed successfully.',
        result: signature
      }
    } catch (e) {
      return {
        success: false,
        error: (e as any).message ?? 'Unknown error'
      }
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    if (!(await this.checkConnection())) return connectionFailedError
    assert(this.provider && this.path)
    try {
      const signedTx = await this.provider.signTransaction(tx, this.path)
      return {
        success: true,
        message: 'Transaction signed successfully.',
        result: signedTx
      }
    } catch (e) {
      return {
        success: false,
        error: (e as any).message ?? 'Unknown error'
      }
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      const unsignedTx = await constructTxHeader(tx)
      const signedTx = await this.signTx(unsignedTx, KeyTypes.Active)
      if (!signedTx.success || !signedTx.result) return signedTx
      const { Transaction } = await import(/* webpackChunkName: 'hive-tx' */ 'hive-tx')
      const txId = new Transaction(signedTx.result).digest().txId
      const broadcasted = await broadcastTx(signedTx.result, this.api)
      if (broadcasted.error)
        return {
          success: false,
          error: broadcasted.error.message ?? 'Failed to broadcast transaction due to unknown error'
        }
      else
        return {
          success: true,
          message: 'The transaction has been broadcasted successfully.',
          result: txId
        }
    } catch (e) {
      return {
        success: false,
        error: 'Failed to sign or broadcast tx due to unknown error'
      }
    }
  }
}
