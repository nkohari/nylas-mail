import OnboardingActions from './onboarding-actions';
import {AccountStore, Actions, IdentityStore} from 'nylas-exports';
import {shell, ipcRenderer} from 'electron';
import NylasStore from 'nylas-store';
import {buildWelcomeURL} from './onboarding-helpers';

function accountTypeForProvider(provider) {
  if (provider === 'eas') {
    return 'exchange';
  }
  if (provider === 'custom') {
    return 'imap';
  }
  return provider;
}

class OnboardingStore extends NylasStore {
  constructor() {
    super();

    this.listenTo(OnboardingActions.moveToPreviousPage, this._onMoveToPreviousPage)
    this.listenTo(OnboardingActions.moveToPage, this._onMoveToPage)
    this.listenTo(OnboardingActions.accountJSONReceived, this._onAccountJSONReceived)
    this.listenTo(OnboardingActions.authenticationJSONReceived, this._onAuthenticationJSONReceived)
    this.listenTo(OnboardingActions.setAccountInfo, this._onSetAccountInfo);
    this.listenTo(OnboardingActions.setAccountType, this._onSetAccountType);

    const {existingAccount, addingAccount} = NylasEnv.getWindowProps();

    const identity = IdentityStore.identity();
    if (identity) {
      this._accountInfo = {
        name: `${identity.firstname || ""} ${identity.lastname || ""}`,
      };
    } else {
      this._accountInfo = {};
    }

    if (existingAccount) {
      const accountType = accountTypeForProvider(existingAccount.provider);
      this._pageStack = ['account-choose']
      this._accountInfo = {
        name: existingAccount.name,
        email: existingAccount.emailAddress,
      };
      this._onSetAccountType(accountType);
    } else if (addingAccount) {
      this._pageStack = ['account-choose'];
    } else {
      this._pageStack = ['welcome'];
    }
  }

  _onOnboardingComplete = () => {
    // When account JSON is received, we want to notify external services
    // that it succeeded. Unfortunately in this case we're likely to
    // close the window before those requests can be made. We add a short
    // delay here to ensure that any pending requests have a chance to
    // clear before the window closes.
    setTimeout(() => {
      ipcRenderer.send('account-setup-successful');
    }, 100);
  }

  _onSetAccountType = (type) => {
    let nextPage = "account-settings";
    if (type === 'gmail') {
      nextPage = "account-settings-gmail";
    } else if (type === 'exchange') {
      nextPage = "account-settings-exchange";
    }
    Actions.recordUserEvent('Auth Flow Started', {type});
    this._onSetAccountInfo(Object.assign({}, this._accountInfo, {type}));
    this._onMoveToPage(nextPage);
  }

  _onSetAccountInfo = (info) => {
    this._accountInfo = info;
    this.trigger();
  }

  _onMoveToPreviousPage = () => {
    this._pageStack.pop();
    this.trigger();
  }

  _onMoveToPage = (page) => {
    this._pageStack.push(page)
    this.trigger();
  }

  _onAuthenticationJSONReceived = (json) => {
    const isFirstAccount = AccountStore.accounts().length === 0;

    Actions.setNylasIdentity(json);

    setTimeout(() => {
      if (isFirstAccount) {
        this._onSetAccountInfo(Object.assign({}, this._accountInfo, {
          name: `${json.firstname || ""} ${json.lastname || ""}`,
          email: json.email,
        }));
        OnboardingActions.moveToPage('account-choose');
      } else {
        this._onOnboardingComplete();
      }
    }, 1000);
  }

  _onAccountJSONReceived = (json) => {
    try {
      const isFirstAccount = AccountStore.accounts().length === 0;

      AccountStore.addAccountFromJSON(json);
      this._accountFromAuth = AccountStore.accountForEmail(json.email_address);

      Actions.recordUserEvent('Auth Successful', {
        provider: this._accountFromAuth.provider,
      });
      ipcRenderer.send('new-account-added');
      NylasEnv.displayWindow();

      if (isFirstAccount) {
        this._onMoveToPage('initial-preferences');
        Actions.recordUserEvent('First Account Linked');

        // open the external welcome page
        const url = buildWelcomeURL(this._accountFromAuth);
        shell.openExternal(url, {activate: false});
      } else {
        this._onOnboardingComplete();
      }
    } catch (e) {
      NylasEnv.reportError(e);
      NylasEnv.showErrorDialog("Unable to Connect Account", "Sorry, something went wrong on the Nylas server. Please try again. If you're still having issues, contact us at support@nylas.com.");
    }
  }

  page() {
    return this._pageStack[this._pageStack.length - 1];
  }

  pageDepth() {
    return this._pageStack.length;
  }

  accountInfo() {
    return this._accountInfo;
  }

  accountFromAuth() {
    return this._accountFromAuth;
  }
}

export default new OnboardingStore();