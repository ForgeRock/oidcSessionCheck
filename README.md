# OIDC Session Check

JavaScript library to assist with binding sessions between an OIDC OP and RP

## Purpose

When you use [OpenID Connect](https://openid.net/specs/openid-connect-core-1_0.html) to handle authentication in your application, there are two parties involved - the "OpenID Provider" (OP) and the Relying Party (RP).

The OP is a web server, and it handles authenticating the user. Oftentimes, when the user logs into the OP with a browser there is a session created there. The OP will set a cookie in the user's browser, which allows the user to be remembered the next time they visit the OP.

The RP is an application which uses the identity details returned from the OP. Typically, it uses these details to construct it's own session. The session at the RP does not normally have any relationship to the session at the OP; if a user logs-out of one, it doesn't normally cause the session to end on the other.

When RP applications are owned by the same organization as the OP, there is often a desire to make the various sessions more closely associated. Doing so presents the user with a seamless experience as they navigate between each app. This library is designed to make that session association easier to establish.

## How it works

The cookie which identifies the session at the OP is assumed to be unavailable to the RP (due to differences in their respective domains). However, there is a mechanism available as part of OIDC which allows that cookie to be used. OIDC works by redirection between the RP and OP - the browser makes a request to the OP's "authorization endpoint"; when finished, the OP redirects the browser back to the RP's "redirect_uri" along with some relevant data. This redirection allows the fundamental "session check" to occur - through it you can compare the details of the session at the RP with the details of the session at the OP.

This redirection needs to be non-intrusive; it shouldn't be noticeable to the user while they are interacting with the RP. The most practical way to accomplish this is to make use of hidden iframes within the RP application. The RP can set the iframe `src` value to be the OP authorization endpoint (along with the other required parameters); when this loads, the OP session cookie will be passed along as per normal browser behavior.

Since this use-case involves simple message passing (with no direct user interaction) there is parameter that is always passed along in the authentication request - `prompt=none`. By including this parameter, the response will either succeed immediately or fail immediately - there won't be any "prompt" for the user to log in or anything else.

Comparing session details can be done in one of two places - either at the OP or the RP. Each choice has advantages and disadvantages. Both approaches involve making a hidden iframe-based request to the authorization endpoint - what distinguishes these approaches is the `response_type` and `id_token_hint` parameters.

### response_type=id_token
If you compare session details at the RP, the authorization request uses `response_type=id_token` to try to get back a new `id_token` value representing the state of the OP session. This is essentially an "implicit" OIDC grant; the result (either a new `id_token` or an error message) will be passed back to the RP redirect URI within the hash fragment (see the specification for [Implicit Flow Authentication Requests](https://openid.net/specs/openid-connect-core-1_0.html#rfc.section.3.2.2.1) for more details). When the current OP session is still valid, the RP can compare the claims from the new `id_token` with the claims from its original `id_token`. The RP can then decide which claim differences matter to it (for example, a different subject), and respond accordingly. This is the default behavior for this library.

### response_type=none
If you compare session details at the OP, the RP has to send along its original `id_token` in the authorization request as the `id_token_hint` parameter. The expectation is that the OP will use the claims from the provided `id_token` and compare them with the details of the OP session (as identified by the OP session cookie which is also included in the authorization request). In this case, the RP does not need any particular information when the session is still valid; as such, the authorization request will include `response_type=none`. Depending on how the OP compares the details, it will either respond with an error such as `login_required` or with no URL parameters at all - indicating that the session is still valid. This is the pattern of session checking [documented for ForgeRock  Access Management](https://backstage.forgerock.com/docs/am/7/oidc1-guide/manage-sessions-openid-connect.html#session_management_state) - although both options will work with ForgeRock Access Management.

Regardless of the approach used, the response from the OP must be read by the redirect_uri page within the iframe. Based on the parameters provided, it must use the [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) API to communicate the results to the RP parent frame.

## Using this library

This library automates the iframe creation and message passing between your RP and the OP. It allows you to easily monitor the state of the OP session - you simply need to provide a few details about your operating environment and decide when you want those checks to be made.

The "SessionCheck" module can be loaded in several ways:
 - using a global variable by directly including a script tag: `<script src="sessionCheckGlobal.js"></script>`
 - using CommonJS modules: `var SessionCheck = require('sessionCheck');`

*Setting up the environment:*
```javascript
    var sessionCheck = new SessionCheck({
        clientId: "myRP",
        opUrl: "https://login.example.com/oauth2/authorize",

        // optional, defaults to "id_token". Other valid value is "none"
        responseType: "id_token",

        // optional, used with `response_type=id_token` to enforce subject consistency
        subject: loggedInUsername,

        // required if using `response_type=none`. If used with `response_type=id_token`, will be used to enforce subject consistency
        idIoken: current_id_token,

        // required function to handle invalid sessions. Take whatever appropriate measures for your app here.
        // reason could be interaction_required, login_required, subject_mismatch, nonce_mismatch or possibly other responses from the OP
        // request_check_count is an integer representing the number of session check requests that have been attempted, as of this invocation
        invalidSessionHandler: function (reason, request_check_count) {
            logoutFromRP();
        },

        // optional. Only called when using `responseType=id_token`
        // claims is the detailed claim information obtained from the latest id_token response
        // request_check_count is an integer representing the number of session check requests that have been attempted, as of this invocation
        sessionClaimsHandler: function (claims, request_check_count) {
            // do something interesting with the new claims, like compare them to old claims for meaningful differences to the session
        },

        // optional
        cooldownPeriod: 5,

        // optional
        redirectUri: "sessionCheck.html",

        // optional - only used with `responseType=id_token`
        scope: "openid"
    });
```
*Examples for when to check the session:*

    // check with various events based on user interaction:
    document.addEventListener("click", function () {
        sessionCheck.triggerSessionCheck();
    });
    document.addEventListener("keypress", function () {
        sessionCheck.triggerSessionCheck();
    });

    // check every minute (not recommended)
    setInterval(function () {
        sessionCheck.triggerSessionCheck();
    }, 60000);

*Details you need to provide:*

 - clientId - The id of this RP client within the OP
 - opUrl - Full URL to the OP Authorization Endpoint
 - responseType [default: id_token] - One of either "id_token" or "none". See "How it works" above for the full description of each.
 - subject [optional] - Only used with `responseType=id_token`. The user currently logged into the RP. If not supplied, subject changes won't trigger the invalidSessionHandler
 - idToken - The current id_token value from your original OIDC authorization request. Required if using `responseType=none`
 - invalidSessionHandler - function to be called once any problem with the session is detected, with reason for the invalid sessions and request count included
 - sessionClaimsHandler [optional] - function to be called after every successful session check, with latest claims and request count included. Only used with `responseType=id_token`.
 - initialSessionSuccessHandler [optional] - optional function to be called after the first successful session check request.
 - redirectUri [default: sessionCheck.html] - The redirect uri registered in the OP for session-checking purposes
 - cooldownPeriod [default: 5] - Minimum time (in seconds) between requests to the opUrl
 - scope [default: openid] - OIDC scope names (space separated) to be requested. Only used with `responseType=id_token`.

This library requires that your user is already authenticated prior to creating an instance of it. If you are using `responseType=none`, you *must* provide the current `id_token` associated with the current authenticated session. If you are using `responseType=id_token`, you can provide the current "subject" of the current session, and this will be checked against the "subject" claim within the id_token that is returned by the OP. If they don't match, it is assumed that the OP and RP sessions are out of sync, and that will trigger the `invalidSessionHandler` with the reason "subject_mismatch".

The `invalidSessionHandler` will be called whenever there is a problem detected from the OP response. The intent for this handler is for you to trigger a local log-out event, so that the current RP session is terminated. This will likely result in an interactive OIDC-based redirection to the OP so as to obtain a new RP session. It will be given the reason for the failure, along with the number of attempts that have so far been made to check the session. You might find using these details to handle specific cases can result in a better user-experience for those cases.

If you are using `responseType=id_token`, the `sessionClaimsHandler` will be called every time the session check occurs. It will include the claims from the new id_token. The intent for this handler is to allow you to respond to various claims that might be included in the id_token - for example, you could use the "exp" claim to warn the user when their session will end. This handler is optional.

The `initialSessionSuccessHandler` will be called once, upon the first successful session check request. This can be a useful function to define if you don't want to load any main application code until after you have established that the current session is valid.

You will need to make sure the redirect_uri used for this is registered with the OP. By default, you can use the included [sessionCheck.html](./sessionCheck.html) as the uri to register. Whatever you choose to use, be sure the [sessionCheckFrame.js](./sessionCheckFrame.js) code is included within it.

It is up to you to decide how frequently and in which circumstances you want to check the OP for session status changes. The "cooldownPeriod" setting determines the maximum frequency you want to check the OP. Regardless of how many times you call `triggerSessionCheck()` within that period, it will only be checked once. As a result, you can call this using any combination of events without worrying about flooding the OP with requests.

*Cleaning up the environment*

Once the SessionCheck instance is no longer needed you should `destroy()` and nullify the instance to garbage collect the instance, the related iframe, and global event handlers.

```javascript
    var sessionCheck = new SessionCheck(config);
    // use sessionCheck... then when you're done with it...
    sessionCheck.destroy();
    sessionCheck = null;
```

## License

MIT. Copyright ForgeRock, Inc. 2020-2021
