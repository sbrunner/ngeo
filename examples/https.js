/*
 * Auto redirect to https to prevent CORS exceptions
 */
if (window.location.protocol == 'http:' &&
    window.location.port != '3000' &&
    window.location.host != 'localhost') {
  let restOfUrl = window.location.href.substr(5);
  /** @type {Location} */
  window.location = 'https:' + restOfUrl;
}
