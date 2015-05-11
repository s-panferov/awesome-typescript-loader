import {Item} from './shared/item';
import {ClientTag} from './client-tag';

export class ClientItem implements Item {
    foo: any;
    test: string
}

var newTag = new ClientTag();