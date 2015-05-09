/// <amd-dependency path="./shared/item" />

import {Item} from './shared/item';
import {ClientTag} from './client-tag';

export class ClientItem implements Item {
    foo: any;
}

var newTag = new ClientTag();