// VERBATIM excerpt of 9router@0.5.111 (MIT, https://www.npmjs.com/package/9router), chunks/2380.js, the case"deepseek" branch of the thinking serializer. Wrapped as a webpack chunk only so it parses.
function serialize(a,b,e,i,j,o,k){switch(a){case"deepseek":{if(i&&j){b.thinking={type:"disabled"};break}b.thinking={type:"enabled"};let a=o(k),c="xhigh"===a||"max"===a?"max":("low"===a||"minimal"===a)&&e?.includes("low")?"low":"high";b.reasoning_effort="max"===c&&e&&!e.includes("max")?"high":c;break}}}
exports.serialize=serialize;
