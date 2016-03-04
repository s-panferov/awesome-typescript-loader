import { sum } from './lib';
import { mul } from './exclude/ignored';

sum('asdf', /asdf/);

// should be any
mul('asdf', /asdf/);
