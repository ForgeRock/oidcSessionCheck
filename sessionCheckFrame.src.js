(function () {
    "use strict";
    /**
     * This code is designed to run in the context of a window (or frame)
     * that has been loaded as the redirect_uri target of an OIDC grant. Parameters
     * passed to this window may be provided in the hash fragment values or in the
     * query string; in either case, they will be provided as normal key1=value&key2=value
     * entries. Note that it is expected that there should never be any "access_token"
     * values present in either form of the parameters.
     *
     * For more details on the hash fragment query string format see :
     * https://openid.net/specs/openid-connect-core-1_0.html#ImplicitAuthResponse
     *
     * If you are using the "id_token" response type, the code expects there to be
     * these values in sessionStorage prior to handling the authentication response:
     *
     * - "sessionCheckNonce" - This should be set during the authentication request, and it must
     *                         match the value found in the "nonce" claim of the id_token
     *
     * - "sessionCheckSubject" - This is the user that is currently logged-in to the RP. It
     *                           must match the "sub" claim of the id_token, otherwise it is
     *                           assumed that a different user has logged into the OP and the RP
     *                           session is therefore invalid.
     *
     * In the case when any errors are detected with the OP session, a "sessionCheckFailed"
     * message will be sent to the parent frame using the postMessage API.
     *
     */

    if (parent.window.origin !== window.origin) {
        // have to be running within a child frame hosted on the same origin
        return;
    }

    /**
     * Simple jwt parsing code purely used for extracting claims.
     */
    function getIdTokenClaims(id_token) {
        return JSON.parse(
            atob(id_token.split(".")[1].replace("-", "+").replace("_", "/"))
        );
    }

    var response_params = window.location.hash
        .replace("#","")
        .concat("&" + window.location.search.replace("?", ""))
        .split("&")
        .reduce(function (result, entry) {
            var pair = entry.split("=");
            if (pair[0] && pair[1]) {
                result[pair[0]] = pair[1];
            }
            return result;
        }, {});

    // will only be seen when the response_type is "id_token"
    if (response_params.id_token) {
        var new_claims = getIdTokenClaims(response_params.id_token);
        var nonceMap = JSON.parse(sessionStorage.getItem("sessionCheckNonce"));
        if (nonceMap[response_params.state] !== Number(new_claims.nonce)) {
            parent.postMessage({
                "message": "sessionCheckFailed",
                "reason": "nonce_mismatch",
                "authId": response_params.state
            }, document.location.origin);
            return;
        }

        var subjectMap = JSON.parse(sessionStorage.getItem("sessionCheckSubject"));
        if (subjectMap[response_params.state] && new_claims.sub !== subjectMap[response_params.state]) {
            parent.postMessage({
                "message": "sessionCheckFailed",
                "reason": "subject_mismatch",
                "authId": response_params.state
            }, document.location.origin);
            return;
        }

        parent.postMessage({
            "message": "sessionCheckSucceeded",
            "claims": new_claims,
            "authId": response_params.state
        }, document.location.origin);
    } else if (response_params.error) {
        parent.postMessage({
            "message": "sessionCheckFailed",
            "reason": response_params.error
        }, document.location.origin);
        return;
    } else {
        // should only be here when the response_type is "none"
        parent.postMessage({
            "message": "sessionCheckSucceeded",
            "authId": response_params.state
        }, document.location.origin);
    }

}());
