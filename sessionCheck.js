(function () {
    "use strict";
    /**
     * Module used to setup the browser environment needed to verify that the
     * session at the OpenID Provider is still valid and associated with the
     * same user authenticated within this app (the OIDC Relying Party).
     * @module SessionCheck
     * @param {Object} config - configuration needed for working with the OP

     * common config options
     * @param {string} [config.subject] - (optional) The user currently logged into the RP. Not usable with responseType=none.
     * @param {function} config.invalidSessionHandler - function to be called once any problem with the session is detected
     * @param {function} [config.initialSessionSuccessHandler] - optional function to be called after the first successful session check request.
     * @param {number} [config.cooldownPeriod=5] - Minimum time (in seconds) between requests to the opUrl

     * amUrl, ssoToken and ssoTokenName are only used when using ForgeRock-specific session validation calls
     * @param {string} [config.amUrl] - The full URL (including path to the base of the realm) of the AM server that issued the ssoToken
     * @param {string} [config.ssoToken] - String representing the user's session within AM. Likely made available as a custom idToken claim
     * @param {string} [config.ssoTokenName] - Name of the session token. Defaults to iPlanetDirectoryPro

     * remaining options only used for standards-based session validation calls
     * @param {string} config.opUrl - Full URL to the OP Authorization Endpoint
     * @param {string} [config.responseType=id_token] - Response type to use to check the session. Supported options are id_token or none.
     * @param {string} config.clientId - The id of this RP client within the OP
     * @param {string} config.authId - The unique id to identify this config and any associated requests
     * @param {string} [config.idToken] - The first id_token obtained as part of an interactive grant. Only used with responseType=none.
     * @param {string} [config.redirectUri=sessionCheck.html] - The redirect uri registered in the OP for session-checking purposes
     * @param {string} [config.scope=openid] - Session check scope; can be space-separated list
     * @param {function} [config.sessionClaimsHandler] - optional function to be called after every session check request. Only invoked when using responseType=id_token. Includes the claims and the count of session check requests that have been made so far.
     */
    module.exports = function (config) {
        var calculatedUriLink;

        this.request_check_count = 0;
        this.cooldownPeriod = config.cooldownPeriod || 5;
        this.subject = config.subject;

        if (config.ssoToken) {
            this.ssoTokenName = config.ssoTokenName || "iPlanetDirectoryPro";
            this.ssoToken = config.ssoToken;
            this.amUrl = config.amUrl + "/sessions?_action=validate";
            this.validationHandler = (function (responseText) {
                try {
                    var validationResponse = JSON.parse(responseText);
                } catch (e) {
                    config.invalidSessionHandler(e.message, this.request_check_count);
                    return;
                }
                if (!validationResponse.valid) {
                    config.invalidSessionHandler("invalid_session", this.request_check_count);
                    return;
                }
                if (this.subject && this.subject !== validationResponse.uid) {
                    config.invalidSessionHandler("subject_mismatch", this.request_check_count);
                    return;
                }
                if (config.initialSessionSuccessHandler && this.request_check_count === 1) {
                    config.initialSessionSuccessHandler();
                }
            }).bind(this);
        } else { // using the standards-based prompt=none iframe approach

            if (!config.redirectUri) {
                // trick used to make the DOM resolve a complete URI based on the relative URI
                calculatedUriLink = document.createElement("a");
                calculatedUriLink.href = "sessionCheck.html";

                this.redirectUri = calculatedUriLink.href;
            } else {
                this.redirectUri = config.redirectUri;
            }
            this.idToken = config.idToken;
            this.clientId = config.clientId;
            this.authId = config.authId || "Primary";
            this.opUrl = config.opUrl;
            this.responseType = config.responseType || "id_token";

            if (this.responseType === "none" && !this.idToken) {
                throw "When using the 'none' response type, you must supply an idToken value to use as a hint when calling the OP.";
            }

            if (this.responseType === "id_token") {
                this.scope = config.scope || "openid";
            }

            /*
             * Attach a hidden iframe onto the main document body that is used to perform
             * background OP-session checking
             */
            this.iframe = document.createElement("iframe");
            this.iframe.setAttribute("id", "sessionCheckFrame-" + this.authId);
            this.iframe.setAttribute("style", "display:none");
            document.getElementsByTagName("body")[0].appendChild(this.iframe);
            this.eventListenerHandle = (function (e) {
                if (e.data.authId && e.data.authId !== this.authId) {
                    return;  
                }
                if (e.origin !== document.location.origin) {
                    return;
                }
                if (e.data.message === "sessionCheckFailed" && config.invalidSessionHandler) {
                    config.invalidSessionHandler(e.data.reason, this.request_check_count);
                }
                if (e.data.message === "sessionCheckSucceeded") {
                    // Note that claims will only be available if using responseType=id_token
                    if (config.sessionClaimsHandler && e.data.claims) {
                        config.sessionClaimsHandler(e.data.claims, this.request_check_count);
                    }
                    if (config.initialSessionSuccessHandler && this.request_check_count === 1) {
                        config.initialSessionSuccessHandler();
                    }
                }
            }).bind(this);
            window.addEventListener("message", this.eventListenerHandle);

            if (this.subject) {
                sessionStorage.setItem("sessionCheckSubject-" + this.authId, this.subject);
            }
        }

        return this;
    };

    /**
     * Private function only to be called through the triggerSessionCheck function.
     * Responsible for starting the interaction with the identity provider, using
     * whichever method appropriate. If using standard approach, then it will
     * update the hidden iframe url to trigger the implicit-flow-based
     * id_token grant and construct the nonce value, which is later verified in
     * the sessionCheckFrame code. If using the ForgeRock approach, then it makes
     * an XHR call to the session validation endpoint.
     */
    var sessionCheckRequest = function(config) {
        if (config.ssoToken) {
            var req = new XMLHttpRequest();
            req.addEventListener("load", function () {
                config.validationHandler(this.responseText);
            });
            req.open("POST", config.amUrl);
            req.setRequestHeader(config.ssoTokenName, config.ssoToken);
            req.setRequestHeader("Accept-API-Version", "resource=2.1, protocol=1.0");
            req.send();
        } else {
            if (!config.iframe) {
                // This session check instance has been destroyed
                return;
            }
            var authorizationUrl = config.opUrl + "?prompt=none" +
                    "&client_id="     + config.clientId +
                    "&response_type=" + config.responseType +
                    "&redirect_uri="  + config.redirectUri + 
                    "&state=" + config.authId;

            if (config.responseType === "id_token") {
                var nonce = Math.floor(Math.random() * 100000);
                sessionStorage.setItem("sessionCheckNonce-" + config.authId, nonce);
                authorizationUrl += "&nonce=" + nonce;
            }

            if (config.scope) {
                authorizationUrl += "&scope=" + config.scope;
            }

            if (config.idToken) {
                authorizationUrl += "&id_token_hint=" + config.idToken;
            }

            config.iframe
                .contentWindow.location.replace(authorizationUrl);
        }
    };

    /** @function triggerSessionCheck
     * Call this function as frequently as you like (based on either events or
     * set intervals) - the check to the OP will only occur once per cooldown period.
     */
    module.exports.prototype.triggerSessionCheck = function () {
        // Helper function used to prevent simultaneous requests being issued
        function sessionCheckRequestCooldown() {
            var timestamp = (new Date()).getTime();
            if (!this.checkSessionTimestamp || (this.checkSessionTimestamp + (this.cooldownPeriod * 1000)) < timestamp) {
                this.checkSessionTimestamp = timestamp;
                this.request_check_count++;
                sessionCheckRequest(this);
            }
        }

        sessionCheckRequestCooldown.call(this);
    };

    /**
     * Destroys the OIDC session check instance to allow garbage collection; removes the iframe and associated iframe event listeners.
     * Recommend dereferencing of session check after destruction to prevent use of impotent SessionCheck instance.
     * @example
     * // Good example
     * this.sc = new SessionCheck(config)
     * // use this.sc, then...
     * this.sc.destroy()
     * this.sc = null
     * @example
     * // Good example
     * function() {
     *   const sc = new SessionCheck(config)
     *   // use sc, then...
     *   sc.destroy()
     * } // at the end of the function the session check goes out of scope and is cleaned up by the garbage collector, along with the iframe and event handler.
     * @example
     * // Bad example
     * this.sc = new SessionCheck(config)
     * // use this.sc, then...
     * this.sc = null // does not remove iframe or event listener, meaning events will still occur and the garbage collector will not collect this.sc
     */
    module.exports.prototype.destroy = function() {
        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        sessionStorage.removeItem("sessionCheckSubject-" + this.authId);
        sessionStorage.removeItem("sessionCheckNonce-" + this.authId);
        removeEventListener("message", this.eventListenerHandle, false);
        this.iframe = null;
        this.eventListenerHandle = null;
    };
}());
