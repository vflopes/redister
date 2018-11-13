'use strict';
const HEXBASE = 16;
module.exports = () => '#000000'.replace(/0/g, () => (~~(Math.random()*HEXBASE)).toString(HEXBASE));