var test = require('./import');
console.log(test.test());

var Item = require('./classes/client-item'); // works
var Tag = require('./classes/client-tag');

console.log(new Item());
console.log(new Tag());

