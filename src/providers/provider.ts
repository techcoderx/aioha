import { KeyTypes, LoginOptions, LoginResult, OperationResult } from '../types'

export abstract class AiohaProvider {
  protected provider: any

  constructor(options?: any) {}

  // authentication
  abstract login(username: string, options: LoginOptions): Promise<LoginResult>
  abstract loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult>
  abstract logout(): Promise<void>
  abstract loadAuth(): boolean

  // memo
  abstract decryptMemo(username: string, memo: string, keyType: KeyTypes): Promise<OperationResult>
}
