(function () {
    "use strict";
    /**
     * Module used to setup the browser environment needed to verify that the
     * session at the OpenID Provider is still valid and associated with the
     * same user authenticated within this app (the OIDC Relying Party).
     * @module SessionCheck
     * @param {Object} config - configation needed for working with the OP
     * @param {string} [config.subject] - The user currently logged into the RP. Either the subject or the idToken are required
     * @param {string} [config.idToken] - The first id_token obtained as part of an interactive grant. Either the subject or the idToken are required
     * @param {string} [config.responseType=id_token] - Response type to use to check the session. Supported options are id_token or none.
     * @param {string} config.clientId - The id of this RP client within the OP
     * @param {string} config.opUrl - Full URL to the OP Authorization Endpoint
     * @param {function} config.invalidSessionHandler - function to be called once any problem with the session is detected
     * @param {string} [config.redirectUri=sessionCheck.html] - The redirect uri registered in the OP for session-checking purposes
     * @param {number} [config.cooldownPeriod=5] - Minimum time (in seconds) between requests to the opUrl
     * @param {string} [config.scope=openid] - Session check scope; can be space-separated list
     */
    module.exports = function (config) {
        var calculatedUriLink;

        if (!config.redirectUri) {
            // trick used to make the DOM resolve a complete URI based on the relative URI
            calculatedUriLink = document.createElement("a");
            calculatedUriLink.href = "sessionCheck.html";

            this.redirectUri = calculatedUriLink.href;
        } else {
            this.redirectUri = config.redirectUri;
        }
        this.request_check_count = 0;
        this.subject = config.subject;
        this.idToken = config.idToken;
        this.clientId = config.clientId;
        this.opUrl = config.opUrl;
        this.responseType = config.responseType || "id_token";

        if (this.responseType === "none" && !this.idToken) {
            throw "When using the 'none' response type, you must supply an idToken value to use as a hint when calling the OP.";
        }

        this.cooldownPeriod = config.cooldownPeriod || 5;

        if (this.responseType === "id_token") {
            this.scope = config.scope || "openid";
        }

        /*
         * Attach a hidden iframe onto the main document body that is used to perform
         * background OP-session checking
         */
        this.iframe = document.createElement("iframe");
        this.iframe.setAttribute("id", "sessionCheckFrame" + this.clientId);
        this.iframe.setAttribute("style", "display:none");
        document.getElementsByTagName("body")[0].appendChild(this.iframe);
        this.eventListenerHandle = (function (e) {
            if (e.origin !== document.location.origin) {
                return;
            }
            if (e.data.message === "sessionCheckFailed" && config.invalidSessionHandler) {
                config.invalidSessionHandler(e.data.reason, this.request_check_count);
            }

            // Note that "sessionCheckSucceeded" will only be triggered if using responseType=id_token
            if (e.data.message === "sessionCheckSucceeded" && config.sessionClaimsHandler) {
                config.sessionClaimsHandler(e.data.claims, this.request_check_count);
            }
        }).bind(this);
        window.addEventListener("message", this.eventListenerHandle);

        if (this.subject) {
            sessionStorage.setItem("sessionCheckSubject", this.subject);
        }
        return this;
    };

    /**
     * Private function only to be called through the triggerSessionCheck function.
     * Responsible for updating the hidden iframe url to trigger the implicit-flow-based
     * id_token grant. Also constructs the nonce value, which is later verified in
     * the sessionCheckFrame code.
     */
    var idTokenRequest = function(config) {
        if (!config.iframe) {
            // eslint-disable-next-line no-console
            console.warn("This session check instance has been destroyed");
            return;
        }
        var authorizationUrl = config.opUrl + "?prompt=none" +
                "&client_id="     + config.clientId +
                "&response_type=" + config.responseType +
                "&redirect_uri="  + config.redirectUri;

        if (config.responseType === "id_token") {
            var nonce = Math.floor(Math.random() * 100000);
            sessionStorage.setItem("sessionCheckNonce", nonce);
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
    };

    /** @function triggerSessionCheck
     * Call this function as frequently as you like (based on either events or
     * set intervals) - the check to the OP will only occur once per cooldown period.
     */
    module.exports.prototype.triggerSessionCheck = function () {
        // Helper function used to prevent simultaneous requests being issued
        function idTokenRequestCooldown() {
            var timestamp = (new Date()).getTime();
            if (!this.checkSessionTimestamp || (this.checkSessionTimestamp + (this.cooldownPeriod * 1000)) < timestamp) {
                this.checkSessionTimestamp = timestamp;
                this.request_check_count++;
                idTokenRequest(this);
            }
        }

        idTokenRequestCooldown.call(this);
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
        this.iframe = null;
        removeEventListener("message", this.eventListenerHandle, false);
        this.eventListenerHandle = null;
    };
}());
