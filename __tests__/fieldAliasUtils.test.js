const { mapFieldsToInternal, mapFieldsToExternal } = require('../src/fieldAliasUtils');

describe('Field Alias Utils', () => {
  it('should map external names to internal names', () => {
    const input = {
      name: 'John',
      age: 30,
    };
    
    const aliases = {
      name: 'person_name',
      age: 'person_age',
    };
    
    const result = mapFieldsToInternal(input, aliases);
    
    expect(result).toEqual({
      person_name: 'John',
      person_age: 30,
    });
  });

  it('should map internal names to external names', () => {
    const input = {
      person_name: 'John',
      person_age: 30,
    };
    
    const aliases = {
      name: 'person_name',
      age: 'person_age',
    };
    
    const result = mapFieldsToExternal(input, aliases);
    
    expect(result).toEqual({
      name: 'John',
      age: 30,
    });
  });
});
