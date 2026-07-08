/**
 * @type {string}
 */
const keygenKey = __TEMPLATE_key__

/**
 * @type {number}
 */
const keygenLength = __TEMPLATE_length__

__RAW_optional_script__

// app logic, we are ensuring the length is equal to the expected one for some reason
if (keygenKey.length === keygenLength) {
    console.log("okay!")
} else {
    console.error("oh no!")
}