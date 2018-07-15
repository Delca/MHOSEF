['armours', 'sets', 'charms', 'jewels', 'skills', 'weapons'].forEach(arrName => {
    window[arrName + 'Map'] = window[arrName].reduce((acc, item) => (acc[item.id] = item, acc), {});;
});

var BIG_M = 10000;

var Problem = function () {
    this.reset();
};

Problem.prototype.reset = function () {
    this.variables = [];
    this.constraints = [];
    this.costs = {};
};

Problem.prototype.addVariable = function (name, bounds) {
    this.variables.push({
        name,
        bounds,
        type: 'continuous'
    });

    return this.variables[this.variables.length - 1];
};
Problem.prototype.addIntegerVariable = function (name) {
    this.variables.push({
        name,
        type: 'integer'
    });

    return this.variables[this.variables.length - 1];
};
Problem.prototype.addBinaryVariable = function (name) {
    this.variables.push({
        name,
        type: 'binary'
    });

    return this.variables[this.variables.length - 1];
};

Problem.prototype.addConstraint = function (name, coefs, operator, threshold) {
    if (operator === '='){
        return [
            this.addConstraint(name + '_upper', coefs, '<=', threshold)[0],
            this.addConstraint(name + '_lower', coefs, '>=', threshold)[0]
        ];
    }
    
    this.constraints.push({
        name,
        coefs,
        operator,
        threshold
    });

    return [this.constraints[this.constraints.length - 1]];
};

Problem.prototype.setCosts = function (costs) {
    Object.assign(this.costs, costs);
};

function getFormula(costs) {
    return Object
        .getOwnPropertyNames(costs)
        .map(i => (costs[i] >= 0 ? '+' : '') + costs[i] + ' ' + i)
        .reduce((acc, val) => acc + ' ' + val, '');
}

Problem.prototype.toString = function () {
    return [
        'Maximize',
        getFormula(this.costs),
        'Subject to',
        ...(this.constraints.map(c => [c.name + ':', getFormula(c.coefs), c.operator, c.threshold].join(' '))),
        'Bounds',
        ...(this.variables.filter(v=>v.type !== 'integer' && v.type !== 'binary').map((v, i) => [v.bounds[0], '<=', v.name, '<=', v.bounds[1]].join(' '))),
        'General',
        ...(this.variables.filter(v=>v.type === 'integer').map((v, i) => v.name)),
        'Binary',
        ...(this.variables.filter(v=>v.type === 'binary').map((v, i) => v.name)),
        'End'
    ].join('\n');
};

Problem.prototype.solve = function () {
    var lp = glp_create_prob();
    var smcp = new SMCP({presolve: GLP_ON});
    glp_read_lp_from_string(lp, null, this.toString());
    glp_simplex(lp, smcp);

    // Mixed-integer problem
    var status = glp_intopt(lp);
    var mipStatus = glp_mip_status(lp);

    var objective = glp_mip_obj_val(lp);
    var variables = {};
    var constraints = {};
    
    for (var i = 1; i <= glp_get_num_cols(lp); ++i) {
        variables[glp_get_col_name(lp, i)] = glp_mip_col_val(lp, i);
    }
    for (var i = 1; i <= glp_get_num_rows(lp); ++i) {
        constraints[glp_get_row_name(lp, i)] = glp_mip_row_val(lp, i);
    }

    return {
        solved: status === 0 && (mipStatus === 5 || mipStatus === GLP_FEAS), 
        statusText: {
            0: {
                [GLP_UNDEF]: 'Primal solution is undefined (GLP_UNDEF)',
                [GLP_FEAS]: 'Primal solution is feasible (GLP_FEAS)',
                [GLP_INFEAS]: 'Primal solution is infeasible (GLP_UNFEAS)',
                [GLP_NOFEAS]: 'No primal feasible solution exists (GLP_NOFEAS)',
                [GLP_OPT]: 'Optimal solution found (GLP_OPT)',
                [undefined]: 'Success with undefined status'
            }[mipStatus],
            [GLP_EBOUND]: 'Invalid bounds (GLP_EBOUND)',
            [GLP_EROOT]: 'No basis for relaxation (GLP_ERROT)',
            [GLP_ENOPFS]: 'LP relaxation has no primal feasible solution (GLP_ENOPFS)',
            [GLP_ENODFS]: 'LP relaxation has no dual feasible solution (GLP_ENODFS)',
            [GLP_EFAIL]: 'Failed to find a solution (GLP_EFAIL)',
            [GLP_EMIPGAP]: 'MIP gap tolerance reached (GLP_MIPGAP)',
            [GLP_ETMLIM]: 'Time limit exceeded (GLP_ETMLIM)',
            [GLP_ESTOP]: 'Stopped by application (GLP_ESTOP)',
            [undefined]: 'Undefined status'   
        }[status],
        objective,
        variables,
        constraints
    };
};

function formatStats(equipmentIds) {
    var { armourPieceIds, charmId } = equipmentIds;

    var armourPieces = (armourPieceIds || []).map(id => armoursMap[id]);
    var charm = charmsMap[charmId];

    var skills = {};
    var potentialSets = {};

    armourPieces.forEach(a => {
        a.skills.forEach(s => skills[s.skill] = (skills[s.skill] || 0) + s.level);
        potentialSets[a.armorSet.id] = true;
    });

    var potentialSetIds = Object.getOwnPropertyNames(potentialSets);
    potentialSetIds.forEach(setId => {
        var set = setsMap[setId];

        potentialSets[setId] = armourPieceIds.filter(aId => set.pieces.some(a => a.id === aId)).length;

        if (set.bonus) {
            set.bonus.ranks.forEach(r => potentialSets[setId] >= r.pieces ? skills[r.skill.skill] = (skills[r.skill.skill] || 0) + r.skill.level : 0);
        }
    });
    
    if (charm) {
        charm.ranks[charm.ranks.length - 1].skills.forEach(s => skills[s.skill] = (skills[s.skill] || 0) + s.level);
    }
    
    var skillIds = Object.getOwnPropertyNames(skills);

    var log = '';
    log += (armourPieces.length > 0 ? 'ITEMS\n' + armourPieces.map(a => a.name).join('\n') + '\n' : '');
    log += (charm ? charm.name + '\n' : '');
    log += (potentialSetIds.length > 0 ? 'ARMOUR SETS\n' + potentialSetIds.map(setId => {
        var set = setsMap[setId];
        var setLog = set.name + ': ';

        setLog += (
            set.bonus ?
            set.bonus.ranks.map((r, i) => `R${i+1}[${potentialSets[setId]}/${r.pieces}]`).join(' ') :
            `[${potentialSets[setId]}/${set.pieces.length}]`
        );

        return setLog;
    }).join('\n') + '\n' : '');
    log += (skillIds.length > 0 ? 'SKILLs\n' + skillIds.map(id => `[${id}] ${skillsMap[id].name} : ${skills[id]}`).join('\n') : '');

    return log;
}

var MHWProblem = function () {
    Problem.call(this);
    this.requiredSkills = [];
};
MHWProblem.prototype = Object.create(Problem.prototype);
MHWProblem.prototype.constructor = MHWProblem;

MHWProblem.prototype.requireSkill = function (id, level) {
    this.requiredSkills.push({
        id,
        level
    });
};
MHWProblem.prototype.formatStats = function () {
    var solution = this.solution;
    
    var armourPieceIds = Object
        .getOwnPropertyNames(solution.variables)
        .filter(varId => varId[0] === 'a' && solution.variables[varId])
        .map(varId => parseInt(varId.slice(1), 10));
    var charmId = Object
        .getOwnPropertyNames(solution.variables)
        .filter(varId => varId[0] === 'c' && solution.variables[varId])
        .map(varId => parseInt(varId.slice(1), 10))[0];
    
    return formatStats({
        armourPieceIds,
        charmId
    });
}
MHWProblem.prototype.printSolution = function () {
    if (!this.solution) {
        console.error('Define and solve the problem before trying to print the solution');
        return;
    }
    var solution = this.solution;

    console.log('Problem status:', solution.statusText);
    console.log(
        'Objective:', solution.objective,
        'Variables:', this.variables.length,
        'Constraints:', this.constraints.length
    );
    
    console.log(this.formatStats());
};
MHWProblem.prototype.solve = function () {
    this.reset();
    var requiredSkillIds = this.requiredSkills.map(s => s.id);
    
    // For now, filter on only the most immediately relevant items
    var relevantSets = sets.filter(s => s.bonus && s.bonus.ranks.length && s.bonus.ranks.some(r => requiredSkillIds.indexOf(r.skill.skill) !== -1));
    var relevantSetIds = relevantSets.reduce((acc, s) => (acc[s.id] = true, acc), {});
    var relevantArmours = armours.filter(a => relevantSetIds[a.armorSet.id] || a.skills.some(s => requiredSkillIds.indexOf(s.skill) !== -1));
    var relevantCharms = charms.filter(c => c.ranks[c.ranks.length - 1].skills.some(s => requiredSkillIds.indexOf(s.skill) !== -1));
    // var relevantJewels = jewels.filter(j => j.skills.some(s => requiredSkillIds.indexOf(s.skill) !== -1));

    console.log(relevantSets);

    // Add binary variable to determine if each object will be worn
    relevantArmours.forEach(a => a.varId = this.addBinaryVariable('a' + a.id).name);
    relevantCharms.forEach(c => c.varId = this.addBinaryVariable('c' + c.id).name);

    // Add binary variables for each bonus rank of the relevant sets
    relevantSets.forEach(s => s.varIds = s.bonus.ranks.map((r, i) => this.addBinaryVariable('sb' + s.id + 'r' + i).name));

    // Prevent multiple items from being equipped to the same slot
    var armourPiecesPerType = {};
    
    relevantArmours.forEach(a => {
        armourPiecesPerType[a.type] = armourPiecesPerType[a.type] || [];
        armourPiecesPerType[a.type].push(a);
    });
    armourPiecesPerType.charms = relevantCharms;
    
    Object.getOwnPropertyNames(armourPiecesPerType).forEach(slot => {
        if (armourPiecesPerType[slot].length === 0) {
            return;
        }

        var coefs = {};

        armourPiecesPerType[slot].forEach(a => coefs[a.varId] = 1);
        
        this.addConstraint('single' + slot, coefs, '<=', 1);
    });

    // Force the activation of armour set variables when the required
    // number of set pieces is reached
    relevantSets.forEach(s => s.bonus.ranks.forEach((r, i) => {
        var bonusRankVarId = s.varIds[i];
        var coefsForceActivation = {};
        var coefsRestrictActivation = {};
        
        s.pieces.forEach(aCopy => {
            coefsForceActivation[armoursMap[aCopy.id].varId] = 1;
            coefsRestrictActivation[armoursMap[aCopy.id].varId] = -1;
        });

        coefsForceActivation[bonusRankVarId] = -BIG_M;
        coefsRestrictActivation[bonusRankVarId] = BIG_M;
        
        // sum(pieces) - M * bonusRank < requiredPiecesNum
        this.addConstraint(bonusRankVarId + 'force', coefsForceActivation, '<', r.pieces);
        
        // M * bonusRank - sum(pieces) < M - requiredPiecesNum
        // (equivalent to sum(pieces) > requiredPiecesNum - M * (1 - bonusRank))
        this.addConstraint(bonusRankVarId + 'restrict', coefsRestrictActivation, '<', BIG_M - r.pieces);
    }));    

    // Force the solution to reach the required skill levels
    this.requiredSkills.forEach(rs => {
        var coefs = {};

        relevantArmours.forEach(a => (a.skills.some(s => s.skill === rs.id ? coefs[a.varId] = s.level : 0)));
        relevantCharms.forEach(c => (c.ranks[c.ranks.length - 1].skills.some(s => s.skill === rs.id ? coefs[c.varId] = s.level : 0)));
        relevantSets.forEach(s => s.bonus.ranks.forEach((r, i) => r.skill.skill === rs.id ? coefs[s.varIds[i]] = r.skill.level : 0 ));
        
        this.addConstraint('skill' + rs.id, coefs, '>=', rs.level);
    });

    // Setup the cost function
    var slotsCoefs = {};
    
    // Maximize the number of slots (for now, both used and available)
    var slotsNumberWeight = 1;
    relevantArmours.forEach(a => (a.slots.length > 0 ? slotsCoefs[a.varId] = (slotsCoefs[a.varId] || 0) + slotsNumberWeight * a.slots.length : 0));
    
    // Minimize the number of equipment pieces used
    var equipmentQuantityWeight = 10;
    relevantArmours.forEach(a => slotsCoefs[a.varId] = (slotsCoefs[a.varId] || 0) - equipmentQuantityWeight);
    relevantCharms.forEach(c => slotsCoefs[c.varId] = (slotsCoefs[c.varId] || 0) - equipmentQuantityWeight);

    this.setCosts(slotsCoefs);
    
    // Solve the problem
    console.log(this.toString());
    this.solution = Problem.prototype.solve.call(this);

    // Display the problem
    this.printSolution();
};

function execute() {
    defineCustomElements();
    bindActionsToButtons();
}

function defineCustomElements() {
    customElements.define('type-ahead',
        class extends HTMLElement {
        constructor() {
            super();
            let template = document.getElementById('type-ahead');
            let templateContent = template.content;
    
            const shadowRoot = this
                .attachShadow({mode: 'open'})
                .appendChild(templateContent.cloneNode(true));
            
            this.inputElement = this.shadowRoot.getElementById('input-element');
            this.selectElement = this.shadowRoot.getElementById('select-element');
            this.spanElement = this.shadowRoot.getElementById('span-element');
            
            this.inputElement.addEventListener('keyup', e => {
                console.log(e.code);
                if (e.code === 'Enter' || e.code === 'ArrowDown') {
                    if (this.validElements === 1) {
                        this.selectValue(this.selectElement.children[0].value);
                        return;
                    }
                    this.selectElement.focus();
                    return;
                }
                
                this.refreshOptions();
            });
            this.inputElement.addEventListener('focus', _ => {
                this.refreshOptions.bind(this);
                this.selectElement.size = Math.min(this.validElements, 5) || 5;
            });
            this.inputElement.addEventListener('blur', e => {
                console.log('E', e.relatedTarget);
                
                if (e.relatedTarget !== this.selectElement) {
                    this.setOptions(window[this.type]);
                    this.selectElement.size = 1;
                    return;
                }
            });
            this.selectElement.addEventListener('keyup', e => {
                if (e.code === 'Enter') {
                   this.selectValue(this.selectElement.value);
                }
            });
            this.spanElement.innerText = this.type;

            this.type = this.type;
            this.selectedValue = this.selectElement.children[0].value;
        }

        setOptions(arr) {
            this.selectElement.innerHTML = '';

            arr.forEach(o => {
                var option = document.createElement('option');
                
                option.value = o.id;
                option.innerText = o.name;
                
                if (o.disabled) {
                    option.setAttribute('disabled', true);
                } else {
                    option.addEventListener('click', _ => {
                        this.selectValue(o.id);
                    });
                }

                this.selectElement.appendChild(option);
            });
        }

        refreshOptions() {
            if (Array.isArray(window[this.type])) {
                var input = (this.inputElement.value || '').toLowerCase();
                var options = window[this.type]
                    .sort((a, b) => b.name.toLowerCase().indexOf(input) - a.name.toLowerCase().indexOf(input))
                    .map(o => ({
                        id: o.id,
                        name: o.name,
                        disabled: o.name.toLowerCase().indexOf(input) === -1
                    }));

                this.validElements = options.reduce((acc, o) => acc + (o.disabled ? 0 : 1), 0);
                this.setOptions(options);
            }
        }

        get type() {
            return this.getAttribute('type');
        }
        set type(newValue) {
            if (Array.isArray(window[newValue])) {
                this.setAttribute('type', newValue);
                this.setOptions(window[newValue]);
            } else {
                console.error(newValue, 'is not a valid array');
            }
        }

        selectValue(id) {
            if (window[this.type + 'Map'] && window[this.type + 'Map'][id]) {
                this.selectedValue = id;
                this.spanElement.innerText = this.type + ' ' + window[this.type + 'Map'][id].name;
                this.inputElement.value = '';
                this.refreshOptions();
                this.selectElement.value = id;
                this.selectElement.size = 1;

                var event = new Event('change');
                event.newValue = id;
                this.dispatchEvent(event);
            }
        }
    });

    customElements.define('skill-level-selector',
        class extends HTMLElement {
        constructor() {
            super();
            let template = document.getElementById('skill-level-selector');
            let templateContent = template.content;
    
            const shadowRoot = this
                .attachShadow({mode: 'open'})
                .appendChild(templateContent.cloneNode(true));
            
            this.typeaheadElement = this.shadowRoot.getElementById('typeahead-element');
            this.levelElement = this.shadowRoot.getElementById('level-element');
            this.removeElement = this.shadowRoot.getElementById('remove-element');
            this.removeElement.addEventListener('click', _ => document.getElementById('skills-container').removeChild(this));

            this.typeaheadElement.addEventListener('change', e => {
                var skill = skillsMap[e.newValue];

                this.levelElement.max = skill.ranks.length;
            });

        }
        
        get skill() {
            return {
                id: parseInt(this.typeaheadElement.selectedValue, 10),
                level: parseInt(this.levelElement.value, 10)
            };
        }
    });
}

function searchForSet() {
    var skillList = document.getElementById('skills-container');
    var problemStateElement = document.getElementById('problem-state-element');
    var outputElement = document.getElementById('output-element');
    
    var prob = new MHWProblem();
    window.prob = prob;

    Array.from(skillList.children).forEach(skillElement => prob.requireSkill(skillElement.skill.id, skillElement.skill.level));

    //glp_set_print_func(console.log);
    prob.solve();

    problemStateElement.innerText = prob.solution.statusText;
    outputElement.innerText = (prob.solution.solved ? prob.formatStats() : '');
}

function bindActionsToButtons() {
    var skillList = document.getElementById('skills-container');
    var addSkillButton = document.getElementById('add-skill-button-element');
    var searchButton = document.getElementById('search-button-element');
    var clearAllButton = document.getElementById('clear-all-button-element');
    var problemStateElement = document.getElementById('problem-state-element');
    var outputElement = document.getElementById('output-element');

    addSkillButton.addEventListener('click', _ => skillList.appendChild(document.createElement('skill-level-selector')));
    searchButton.addEventListener('click', _ => searchForSet());
    clearAllButton.addEventListener('click', _ => {
        skillList.innerHTML = '';
        problemStateElement.innerText = '';
        outputElement.innerText = '';
        addSkillButton.click();
    });

    addSkillButton.click();
}

window.addEventListener('load', execute);