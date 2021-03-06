// The parser

(function(parser, ast) {
    parser.lastInternalName = 0;

    parser.generateInternalName = function() {
        var parser = haskell.parser;
        
        var name = "__v" + parser.lastInternalName.toString();
        parser.lastInternalName++;
        return name;
    };

    parser.fixity = {};
    parser.fixity.left = 0;
    parser.fixity.right = 1;
    parser.fixity.none = 2;

    parser.Operator = function(prec, fixity, op) {
        this.prec = prec;
        this.fixity = fixity;
        this.op = op;
    };

    parser.opTable = {};

    /**
     * Parses Haskell code
     *
     * Reserved variables in the form __name
     *
     * \code Code to parse
     * \return The ast
     */
    parser.parse = function(code, options) {
        var enableHash = false;
        
        if (options != undefined) {
            if (options.enableHash) {
                enableHash = true;
            }
        }
        
        var reservedid = choice("case", "class", "data", "default", "deriving", "do", "else", "if", "import", "in", 
                                "infix", "infixl", "infixr", "instance", "let", "module", "newtype", "of", "then",
                                "type", "where", "_");
        
        var reservedop = choice("..", ":", "::", "=", "\\", "|", "<-", "->", "@", "~", "=>");

        var integer = action(repeat1(range('0', '9')), function(ast) { return new haskell.ast.Num(parseInt(ast.join(""))); });
        var integerlit = function(state) {
                if (enableHash) {
                    return choice( action(sequence(repeat1(range('0', '9')), '#'), function(ast) {
				return new haskell.ast.PrimitiveValue(parseInt(ast[0].join("")));
                                }),
                                integer)(state);
                } else {
                    return integer(state);
                }
        };

        var ident_ = function(state) {
            if (enableHash) {
                return action(sequence(repeat0(choice(range('A', 'Z'), range('a', 'z'), range('0', '9'), '\'')), optional('#')), function(ast) { 
                    if (ast[1] != false) {
                        return ast[0].join("") + '#';
                    } else {
                        return ast[0].join(""); 
                    }
                })(state);
            } else {
                return action(repeat0(choice(range('A', 'Z'), range('a', 'z'), range('0', '9'), '\'')), function(ast) { return ast.join(""); })(state);
            }
        };
        
        var ident = action(butnot(sequence(range('a', 'z'), ident_), reservedid), function(ast) { return ast.join(""); });
        
        var char_ = choice(range('A', 'Z'), range('a', 'z'), range('0', '9'), ' ', '\\n');
        
        var charlit = function(state) {
            var chr = sequence('\'', char_, '\'');
            if (enableHash) {
                return choice(action(sequence(chr, '#'), function(ast) { return ast[0]; }), 
                              chr)(state);
            } else {
                return chr(state);
            }
        }
        
        var string_ = action(repeat0(char_), function(ast) { return ast.join(""); });
        
        var stringlit = function(state) {
            var str = sequence('"', string_, '"');
            if (enableHash) {
                return choice(action(sequence(str, '#'), function(ast) { return ast[0]; }), 
                              str)(state);
            } else {
                return str(state);
            }
        };
        
        var exponent = sequence(choice('e', 'E'), optional(choice('+', '-')), integer); // todo: fix
        
        var float_ = choice(sequence(integer, expect('.'), integer, optional(exponent)),
                            sequence(integer, exponent));
                            
        var literal = choice(ws(integerlit), ws(charlit), ws(stringlit), ws(float_));
        
        var symbol = choice('!', '#', '$', '%', '&', '*', '+', '.', '/', '<', '=', '>', '?', '@', '\\', '^', '|', '-', '~');
        var sym = action(repeat1(symbol), function(ast) { return ast.join(""); });
        
        var modid = action(sequence(range('A', 'Z'), ident_), function(ast) { return ast.join(""); });
        
        var varid = ident;
        var varsym = butnot(sym, reservedop);
        
        var qvarid = ident;
        var qvarsym = varsym;
        
        var qtycon = action(sequence(range('A', 'Z'), ident_), function(ast) { return ast.join(""); });
        
        var conid = action(sequence(range('A', 'Z'), ident_), function(ast) { return ast.join(""); });
        var consym = butnot(sym, reservedop);
        
        var tycls = conid;
        
        var qtycls = tycls;
        
        var qconsym = consym;
        var qconid = conid;

        var tycon = qtycon;
        var tyvar = varid;        
        var gconsym = choice(':', qconsym);
        
        var qconop = choice(gconsym, sequence(expect(ws('`')), qconid, expect(ws('`'))));
        
        var qvarop = choice(qvarsym, sequence(expect(ws('`')), qvarid, expect(ws('`'))));
        
        var qop = choice(qvarop, qconop);
        
        var conop = choice(consym, sequence(expect(ws('`')), conid, expect(ws('`'))));
        
        var varop = choice(varsym, sequence(expect(ws('`')), varid, expect(ws('`'))));

        var op = choice(varop, conop);
        
        var qcon = choice(qconid, sequence(expect(ws('(')), gconsym, expect(ws(')'))));
        
        var op_paran_action = function(p) {
            return action(p, function(ast) {
                return ast[0];
            });
        }
        
        var con = choice(conid, op_paran_action(sequence(expect(ws('(')), consym, expect(ws(')')))));
        
        var qvar = choice(qvarid, op_paran_action(sequence(expect(ws('(')), qvarsym, expect(ws(')')))));
        
        var var_ = choice(varid, op_paran_action(sequence(expect(ws('(')), varsym, expect(ws(')')))));
        
        var gcon = choice(  ws("()"),
                            ws("[]"),
                            sequence(ws('('), repeat1(ws(',')), ws(')')),
                            ws(qcon)
                         );
        
        var fpat = undefined;
        
        var list_action = function(p) {
            return action(p, function(ast) {
		    if (ast[0] == false) ast[0] = [];
		    return new haskell.ast.List(ast[0]);
                // 0,1,2
                // 0 : 1 : 2 : []
                // ((: 0) 1)
                
                ast = ast[0];
                
                var cons = new haskell.ast.VariableLookup(":");
                var empty = new haskell.ast.VariableLookup("[]");
                
                if (ast.length == 0 || ast == false) {
                    return empty;
                }
                
                var fun = empty;
                for (var i = ast.length - 1; i >= 0; i--) {
                    var f = new haskell.ast.Application(cons, ast[i]);
                    fun = new haskell.ast.Application(f, fun);
                }
                
                return fun;
            });
        }
        
        var list_pattern_action = function(p) {
            return action(p, function(ast) {
                ast = ast[0];
                
                var cons = ":";
                var empty = "[]";
                
                if (ast.length == 0 || ast == false) {
                    return new haskell.ast.PatternConstructor(empty, new Array());
                }
                
                var fun = new haskell.ast.PatternConstructor(empty, new Array());
                for (var i = ast.length - 1; i >= 0; i--) {
                    fun = new haskell.ast.PatternConstructor(cons, [ast[i], fun]);
                }
                
                return fun;
            });
        }
        
        var ident_pattern_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.VariableBinding(ast);
            });
        }
        
        var constant_pattern_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.ConstantPattern(ast);
            });
        }
        
        var combined_pattern_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.Combined(ast[0], ast[1]);
            });
        }
        
        var wildcard_pattern_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.Wildcard();
            });
        }
        
        var cons_pattern_action = function(ast) {
            return function(lhs, rhs) {
                // lhs : rhs
                var cons = ':';
                return new haskell.ast.PatternConstructor(cons, [lhs, rhs]);
            };
        }
        
        var apat = function(state) { return apat(state) };
        var pat = function(state) { return pat(state); };
        
        var apat = choice(  combined_pattern_action(sequence(var_, expect(ws('@')), ws(apat))),
                            action(ws(gcon), function(ast) { return new haskell.ast.PatternConstructor(ast, new Array()); }),
                            constant_pattern_action(ws(literal)),
                            ident_pattern_action(ws(ident)),
                            wildcard_pattern_action (ws('_')), // wildcard
                            action(sequence(expect(ws('(')), pat, expect(ws(')'))), function(ast) { return ast[0]; }), // parans
                            sequence(expect(ws('(')), ws(pat), repeat1(sequence(ws(','), ws(pat))), expect(ws(')'))), // tuple
                            list_pattern_action(sequence(expect(ws('[')), optional(wlist(pat, ',')), expect(ws(']')))) // list
                            );
        
        var gcon_pat_action = function(p) {
            return action(p, function(ast) {
                var constructor = ast[0];
                var patterns = ast[1];
                return new haskell.ast.PatternConstructor(constructor, patterns);
            });
        };
        
        var pat_10 = choice(gcon_pat_action(sequence(ws(gcon), repeat1(ws(apat)))),
                            action(sequence(chainl(ws(apat), action(ws(':'), cons_pattern_action))), function(ast) { return ast[0]; }),
                            apat
                           );
        
        var rpat = undefined;
        
        var lpat = undefined;
        
        var pat = pat_10;
        
        var fbind = undefined;
        
	// Redefined later with the proper definition
        var decls = function(state) { return decls(state); };

        var exp = function(state) { return exp(state); };

        var stmt_exp_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.DoExpr(ast);
            });
        }
        
        var stmt_bind_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.DoBind(ast[0], ast[1]);
            });
        }
        
        var stmt_let_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.DoLet(ast[0][0]);
            });
        };
        
        var infixexp = function(state) { return infixexp(state); };
        
        var stmt = choice( stmt_bind_action(sequence(ws(pat), expect(ws("<-")), ws(exp))),
			   stmt_exp_action(ws(exp)),
                           stmt_let_action(sequence(expect(ws("let")), ws(decls)))
                           );
                            
        var stmts = list(stmt, ws(";"));
        
        var gdpat = undefined;
        
        // todo: fix all alternatives !!!!1 and where!
        var alt_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        
        var alt = sequence(ws(pat), expect(ws("->")), ws(exp));
        
        var alts = list(ws(alt), ws(';'));
        
        var qval = undefined;
        
        var right_section_action = function(p) {
            return action(p, function(ast) {
                // (+ x)
                // \y -> y + x
                
                var arg_name = parser.generateInternalName();
                var op_name = ast[0];
                
                var fun_exp = new haskell.ast.Application(new haskell.ast.VariableLookup(op_name), new haskell.ast.VariableLookup(arg_name));
                fun_exp = new haskell.ast.Application(fun_exp, ast[1]);
                
                var arg = new haskell.ast.VariableBinding(arg_name);
                var fun = new haskell.ast.Lambda(arg, fun_exp);
                
                return fun;
            });
        };
        
        var left_section_action = function(p) {
            return action(p, function(ast) {
                // (x +)
                // \y -> x + y
                
                var arg_name = parser.generateInternalName();
                var op_name = ast[1];
                
                var fun_exp = new haskell.ast.Application(new haskell.ast.VariableLookup(op_name), ast[0]);
                fun_exp = new haskell.ast.Application(fun_exp, new haskell.ast.VariableLookup(arg_name));
                
                var arg = new haskell.ast.VariableBinding(arg_name);
                var fun = new haskell.ast.Lambda(arg, fun_exp);
                
                return fun;
            });
        };
        
        var qual_generator_action = function(p) {
            return action(p, function(ast) {
		    return new haskell.ast.ListBind(ast[0], ast[1]);
            });
        }
        
        var qual_let_action = function(p) {
            return action(p, function(ast) {
		    return new haskell.ast.ListLet(ast[0]); 
            });
        }
        
        var qual_exp_action = function(p) {
            return action(p, function(ast) {
		    return new haskell.ast.ListGuard(ast); 
            });
        }
        
        var qual = choice(  qual_generator_action(sequence(ws(pat), expectws("<-"), ws(exp))),
                            qual_let_action(sequence(expectws("let"), ws(decls))),
                            qual_exp_action(ws(exp))
                         );
        
        var qvar_exp_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.VariableLookup(ast);
            });
        };
        
        var aexp_constant_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.Constant(ast);
            });
        };
        
        var aexp_list_comp_action = function(p) {
            return action(p, function(ast) {
		    return new haskell.ast.ListComprehension(ast[0], ast[1]);
            });
        }
        
        var aexp_arithmetic_action = function(p) {
            return action(p, function(ast) {
                if (ast[1]) {
                    ast[1] = ast[1][0];
                }
                return new haskell.ast.ArithmeticSequence(ast[0], ast[1], ast[2]); 
            });
        }
        
        var aexp_empty_tuple_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var aexp_tuple_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var aexp = choice(  qvar_exp_action(ws(qvar)),
                            qvar_exp_action(ws(gcon)),
                            aexp_constant_action(ws(literal)),
                            action(sequence(expect(ws('(')), ws(exp), expect(ws(')'))), function(ast) { return ast[0]; }), // parans
                            aexp_empty_tuple_action(sequence(expectws('('), expectws(')'))), // empty tuple
                            aexp_tuple_action(sequence(expectws('('), ws(exp), repeat1(sequence(ws(','), ws(exp))) , expectws(')'))), // tuple
                            list_action(sequence(expect(ws('[')), optional(wlist(exp, ',')), expect(ws(']')))),  // list constructor
                            left_section_action(sequence(expect(ws('(')), ws(infixexp), ws(qop), expect(ws(')')))), // left section
                            right_section_action(sequence(expect(ws('(')), ws(qop), ws(infixexp), expect(ws(')')))), // right section, todo: look into resolution of infixexp in this case, see Haskell Report Chapter 3
                            aexp_arithmetic_action(sequence(expectws('['), ws(exp), optional(sequence(expectws(','), ws(exp))), expectws('..'), optional(ws(exp)), expectws(']'))), // arithmetic sequence
                            aexp_list_comp_action(sequence(expectws('['), ws(exp), expectws('|'), list(qual, ws(',')), expectws(']'))) // list comprehension
                            // Todo:
                            //  Labeled construction
                            //  Labeled update
                          );
        
        var fexp = action(repeat1(ws(aexp)), function(ast) {
                       if (ast.length == 1) {
                           return ast[0];
                       } else {
                           // f x y -> (f x) y
                           var f = new haskell.ast.Application(ast[0], ast[1]);
                           for (var i = 2; i < ast.length; i ++) {
                               f = new haskell.ast.Application(f, ast[i]);
                           }
                           return f;
                       }
                   });
        
        var rexp = undefined;
        
        var lexp = undefined;
        
        var lambda_exp_action = function(p) {
            return action(p, function(ast) {
                // \x y -> exp
                // \x -> \y -> exp
                
                var fun = ast[1];
                var patterns = ast[0];
                
                for (var i = patterns.length - 1; i >= 0; i--) {
                    fun = new haskell.ast.Lambda(patterns[i], fun);
                }
                
                return fun;
            });
        };
        
        
        var let_action = function(p) {
            return action(p, function(ast) {
                var decl = ast[0][0];
                var exp = ast[1];
                
                return new haskell.ast.Let(decl, exp);
            });
        };
        
        var case_action = function(p) {
            return action(p, function(ast) {
                var cond = ast[0];
                var alts = ast[1];
                
                return new haskell.ast.Case(cond, alts);
            });
        }
        
        var do_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.Do(ast[0]);
            });
        };
        
        var if_action = function(p) {
            return action(p, function(ast) {
		    return new haskell.ast.If(ast[0], ast[1], ast[2]);
            });
        };
        
        var exp_10 = choice(lambda_exp_action (sequence(expect(ws('\\')), repeat1(ws(apat)), expect(ws("->")), ws(exp))),
                            let_action(sequence(expect(ws("let")), ws(decls), expect(ws("in")), ws(exp))),
                            if_action(sequence(expectws("if"), ws(exp), expectws("then"), ws(exp), expectws("else"), ws(exp))),
                            case_action(sequence(expect(ws("case")), ws(exp), expect(ws("of")), expect(ws("{")), ws(alts), expect(ws("}")))),
                            do_action(sequence(expect(ws("do")), expect(ws("{")), ws(stmts), expect(ws("}")))),
                            ws(fexp)
                            );
        
        var op_action = function(p) { return action(p, function(ast) {
                return function(lhs, rhs) {
                    var fun1 = new haskell.ast.Application(new haskell.ast.VariableLookup(ast), lhs);
                    return new haskell.ast.Application(fun1, rhs);
                };
        })};
        
        var infixexp_action = function(p) {
            return action(p, function(ast) {
                if (ast[2] instanceof Array) {
                    var inner = ast[2];
                    ast.pop();
                
                    for (i in inner) {
                        if (!inner[i].need_resolve)
                            ast.push(inner[i]);
                    }
                }
                
                var op = ast[1];
                ast[1] = new Object();
                ast[1].op = op;
                
                ast.info = new function() { 
                    this.need_resolve = true;
                };
                
                return ast;
            });
        };
        
        var neg_exp_action = function(p) {
            return action(p, function(ast) {
                ast.info = new function() {
                    this.need_resolve = true;
                };
                return ast;
            });
        }
        
        var infixexp = choice( infixexp_action(sequence(ws(exp_10), ws(qop), ws(infixexp))),
                               sequence(ws('-'), ws(infixexp)),
                               ws(exp_10)
                             );
        
        var resolve_op = function(ast) {
            var OpApp = function(e1, op, e2) {
                this.e1 = e1;
                this.op = op;
                this.e2 = e2;
            };
            
            var NegOp = function(e1) {
                this.e1 = e1;
            };
            
            var parseNeg = function(op1, rest) { return parseNeg(op1, rest); };
            var parse = function(op1, e1, rest) { return parse(op1, e1, rest); };
            
            var parse = function(op1, e1, rest) {
                if (rest == null || rest.length == 0) {
                    return { exp: e1, rest: null };
                }
                
                var op2 = rest.shift();
                
                if (op1.prec == op2.prec && (op1.fixity != op2.fixity || op1.fixity == parser.fixity.none)) {
                    alert("invalid operator precedence stuff!");
                    return null;
                }
                
                if (op1.prec > op2.prec || (op1.prec == op2.prec && op1.fixity == parser.fixity.left)) {
                    rest.unshift(op2);
                    return { exp: e1, rest: rest };
                }
                
                var res = parseNeg(op2, rest);
                return parse(op1, new OpApp(e1, op2, res.exp), res.rest);
            };
            
            var parseNeg = function(op1, rest) {
                var e1 = rest.shift();
                
                if (e1.op != undefined && e1.op == '-') {
                    var res = parseNeg(new parser.Operator(6, parser.fixity.left, '-'), rest);
                    return parse(op1, new NegOp(res.exp), res.rest);
                } else {
                    return parse(op1, e1, rest);
                }
            };
            
            parser.opTable[':'] = new parser.Operator(5,parser.fixity.right,':');
            
            for (var i in ast) {
                if (ast[i].op != undefined) {
                    if (parser.opTable[ast[i].op] != undefined) {
                        ast[i] = parser.opTable[ast[i].op];
                    } else {
                        ast[i] = new parser.Operator(5, parser.fixity.right, ast[i].op);
                    }
                }   
            }
            
            ast = parseNeg(new parser.Operator(-1, parser.fixity.none, ''), ast);
            
            var translate = function(op) { return translate(op); };
            var translate = function(op) {
                if (op instanceof NegOp) {
                    var exp = op.e1;
                    
                    if (exp instanceof OpApp || exp instanceof NegOp)
                        exp = translate(exp);
                        
                    return new haskell.ast.Application(new haskell.ast.Application(new haskell.ast.VariableLookup('-'), new haskell.ast.Constant(new haskell.ast.Num(0))), exp);
                } else {            
                    var lhs = op.e1;
                    var rhs = op.e2;
                    
                    if (lhs instanceof OpApp || lhs instanceof NegOp)
                        lhs = translate(lhs);
                    
                    if (rhs instanceof OpApp || rhs instanceof NegOp)
                        rhs = translate(rhs);
                    
                    var fun1 = new haskell.ast.Application(new haskell.ast.VariableLookup(op.op.op), lhs);
                    return new haskell.ast.Application(fun1, rhs);
                }
            };
            
            return translate(ast.exp);
        };

	// redefined later
        var atype = function(state) { return atype(state); };
        var type = function(state) { return type(state); };
        var context = function(state) { return context(state); };

        var exp_type_action = function(p) {
            return action(p, function(ast) {
                var expr = ast[0];
                var contexts = ast[1] ? ast[1][0] : [];
                var type = ast[2];
                var tc = new haskell.ast.TypeConstraint(contexts, type);
                if (expr.info != undefined && expr.info.need_resolve) {
                    expr = resolve_op(ast);
                }
                return new haskell.ast.ExpressionTypeConstraint(expr, tc);
            });
        };
        
        var exp_infix_action = function(p) {
            return action(p, function(ast) {
                if (ast.info != undefined && ast.info.need_resolve) {
                    return resolve_op(ast);
                } else {
                    return ast;
                }
            });
        };
        
        var exp = choice(   exp_type_action(sequence(ws(infixexp), expectws("::"), optional(ws(context), expectws("=>")), ws(type))),
                            exp_infix_action(ws(infixexp)));
        
        var gd_action = function(p) {
            return action(p, function(ast) {
                return ast[0];
            });
        };
        
        var gd = gd_action(sequence(expectws('|'), ws(exp)));
        
        var gdrhs_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var gdrhs_fix_list_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });  
        };
        
        var gdrhs = gdrhs_action(repeat1(gdrhs_fix_list_action(sequence(ws(gd), expectws('='), ws(exp)))));
        
        var decl_rhs_action = function(p) {
            return action(p, function(ast) {
                // todo: desugar where
                return ast[0];
            });
        };
        
        var rhs_gurad_action = function(p) {
            return action(p, function(ast) {
                return ast[0];
            });  
        };
        
        var rhs = choice(   decl_rhs_action(sequence(expect(ws('=')), ws(exp), optional(sequence(expect(ws("where")), ws(decls))))),
                            rhs_gurad_action(sequence(ws(gdrhs), optional(sequence(expect(ws("where")), ws(decls)))))
                        );
        
        // todo: Should be quite a lot of choices here, but those are for 
        //       operators so it's not very important right now
        var funlhs = sequence(ws(var_), repeat0(ws(apat)));
        
        var inst_gtycon_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var inst_gtycon_tyvars_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var inst_tyvars_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var inst_tyvar_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var inst_tyvar_arrow = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };

	// redefined later
        var gtycon = function(state) { return gtycon(state); };

        var inst = choice(  inst_gtycon_action(ws(gtycon)),
                            inst_gtycon_tyvars_action(sequence(expectws('('), gtycon, list(ws(tyvar), ws(',')), expectws(')'))),
                            inst_tyvars_action(list(ws(tyvar), ws(','))),
                            inst_tyvar_action(sequence(expectws('['), tyvar, expectws(']'))),
                            inst_tyvar_arrow(sequence(expectws('('), tyvar, expectws("->"), tyvar, expectws(')')))
                        );
        
        var dclass = qtycls;
        
        var deriving_action = function(p) {
            return action(p, function(ast) {
                // if(ast[0] instanceof Array) 
                //      ast = ast[0];
                return ast;
            });
        };
        
        var deriving = deriving_action(sequence(expectws("deriving"), choice(
                                    ws(dclass),
                                    sequence(expectws('('), list(ws(dclass), ws(',')), expectws(')'))
                                )));
        
        var fielddecl = sequence(ws(vars), expectws("::"), choice(ws(type), sequence(optional(ws('!')), ws(atype))));
        
        var newconstr_con_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var newconstr_var_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };

        var newconstr = choice( newconstr_con_action(sequence(con, atype)),
                                newconstr_var_action(sequence(con, expectws('{'), var_, expectws("::"), type, expectws('}')))
                        );
        
        var constr_action = function(p) {
            return action(p, function(ast) {
                var name = ast[0];
                var arguments = ast[1];
                return new haskell.ast.Constructor(name, arguments);
            });
        };
        
        var constr_op_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var constr_fielddecl_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };

	var fix_sequence_action = function(p) {
	    return action(p, function(ast) {
		    return ast[1];
		});
	};
        
        var constr = choice(constr_action(sequence(ws(con), repeat0(fix_sequence_action(sequence(optional(ws('!')), ws(atype)))))),
                            constr_op_action(sequence(choice(ws(btype), sequence(optional(ws('!')), ws(atype))), ws(conop), choice(ws(btype), sequence(optional(ws('!')), ws(atype))))),
                            constr_fielddecl_action(sequence(ws(con), expectws('{'), list(ws(fielddecl), ws(',')), expectws('}')))
                           ); // Todo: fielddecl stuffz
        
        var constrs = list(ws(constr), ws('|'));
        
        var simpletype = sequence(ws(tycon), optional(ws(list(tyvar, ' '))));
        
        var simpleclass_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var simpleclass = simpleclass_action(sequence(ws(qtycls), ws(tyvar)));
        
        var scontext_one_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        }
        
        var scontext_many_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        }
        
        var scontext = choice(  scontext_one_action(simpleclass),
                                scontext_many_action(sequence(expectws('('), list(ws(simpleclass), ws(',')), expectws(')')))
                             );


	var gtycon_qtycon_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeConstructor(ast);
		});
	};

	var gtycon_qtycon_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeConstructor(ast);
		});
	};

	var gtycon_unit_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeConstructor("()");
		});
	};

	var gtycon_list_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeConstructor("([])");
		});
	};

	var gtycon_arrow_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeConstructor("(->)");
		});
	};

	var gtycon_tupple_action = function(p) {
	    return action(p, function(ast) {
		    var size = ast[0].length+1;
		    var constructor = "(" + new Array(size).join(",") + ")";
		    return new haskell.ast.TypeTupple(constructor, size);
		});
	};

	// redefinition
        gtycon = choice(gtycon_qtycon_action(qtycon),
			//			sequence(repeat1(ws(var_)), repeat0(ws(apat))), // TODO: WTF? A pattern in a type? :/
			gtycon_unit_action("()"),
			gtycon_list_action("[]"),
			gtycon_arrow_action("(->)"),
			gtycon_tupple_action(sequence(ws('('), repeat1(ws(',')), ws(')')))
                            );

	var atype_tyvar_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeVariable(ast);
		});
	};

	var atype_tupple_action = function(p) {
	    return action(p, function(ast) {
		    var size = ast[0].length;
		    var constructor = "(" + new Array(size).join(",") + ")";
		    var type = new haskell.ast.TypeTupple(constructor, size);
		    for (var i in ast[0]) {
			type = new haskell.ast.TypeApplication(type, ast[0][i]);
		    };
		    return type;
		});
	};

	var atype_list_action = function(p) {
	    return action(p, function(ast) {
		    return new haskell.ast.TypeApplication(new haskell.ast.TypeConstructor("([])"), ast[0]);
		});
	};
        
	// redefinition
	atype = choice( gtycon,
			atype_tyvar_action(tyvar),
			atype_tupple_action(sequence(expectws('('), list(ws(type), ws(',')), expectws(')'))),
			atype_list_action(sequence(expectws('['), ws(type), expectws(']'))),
			sequence(expectws('('), ws(type), expectws(')'))
			);

	var btype_action = function(p) {
	    return action(p, function(ast) {
		    var type = ast[0];
		    for (var i = 1; i < ast.length; i++) {
			type = new haskell.ast.TypeApplication(type, ast[i]);
		    }
		    return type;
		});
	};
        
        var btype = btype_action(repeat1(ws(atype)));

	var type_action = function(p) {
	    return action(p, function(ast) {
		    var type = ast[0];
		    for (var i = 1; i < ast.length; i++) {
			type = new haskell.ast.TypeApplication(new haskell.ast.TypeApplication(new haskell.ast.TypeConstructor("(->)"), type), ast[i]);
		    }
		    return type;
		});
	};
	// redefinition
        type = type_action(list(ws(btype), ws("->")));
        
        var fixity = choice(ws("infixl"), ws("infixr"), ws("infix"));
        
        var vars = list(ws(var_), ws(','));
        
        var ops = epsilon_p;

        var class__context_action = function(p) {
            return action(p, function(ast) {
                return new haskell.ast.Constraint(ast[0], ast[1]);
            });
        };
        
        var class_ = choice(class__context_action(sequence(ws(qtycls), ws(tyvar))),
                            sequence(ws(qtycls), ws('('), list(ws(atype), ws(',')) ,ws(')')) // TODO: What is this?
                            );
        
        var context_single_action = function(p) {
            return action(p, function(ast) {
                return [ast];
            });
        };

        var context_multi_action = function(p) {
            return action(p, function(ast) {
                return ast[0];
            });
        };

        // redefinition
        context = choice(   context_single_action(ws(class_)), 
                                context_multi_action(sequence(expectws('('), list(ws(class_), ws(',')) , expectws(')')))
                            );
        
        var fixity_op_action = function(p) {
            return action(p, function(ast) {
                var fixity = ast[0];
                
                var prec = 9;
                if (ast[1] != false)
                    prec = ast[1].num;
                    
                var ops = ast[2];
                
                if (fixity == "infixl")
                    fixity = parser.fixity.left;
                else if (fixity == "infixr")
                    fixity = parser.fixity.right;
                else
                    fixity = parser.fixity.none;
                    
                for (var i in ops) {
                    var op = ops;
                    parser.opTable[op] = new parser.Operator(prec, fixity, op);
                }
                
                return "fixity";
            });
        };

        var gendecl_type_action = function(p) {
            return action(p, function(ast) {
                var vars = ast[0];
                var constraints = ast[1] ? ast[1][0] : [];
                var type = ast[2];
                var tc = new haskell.ast.TypeConstraint(constraints, type);
                return new haskell.ast.TypeConstraintDeclaration(vars, tc);
            });
        };
        
        var gendecl = choice(   gendecl_type_action(sequence(ws(vars), expectws("::"), optional(sequence(ws(context), expectws("=>"))), ws(type))),
                                fixity_op_action(sequence(ws(fixity), optional(ws(integer)), ws(choice(varop, conop)))), // Should be multiple op's
                                epsilon_p
                            );
        
        var idecl_fun_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var idecl = idecl_fun_action(sequence(choice(ws(funlhs), ws(var_)), ws(rhs)));
        
        var idecls_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var idecls = idecls_action(list(ws(idecl), ws(';')));
        
        var cdecl_gendecl_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var cdecl_fun_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var cdecl = choice( cdecl_gendecl_action(gendecl),
                            cdecl_fun_action(sequence(choice(ws(funlhs), ws(var_)), ws(rhs))));
        
        var cdecls_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var cdecls = cdecls_action(list(ws(cdecl), ws(';')));
        
        var fun_action = function(p) {
            return action(p, function(ast) {
                try {
                    if (ast[0] instanceof haskell.ast.Pattern) {
                        return new haskell.ast.Variable(ast[0], ast[1]);
                    } else {        
                        var patterns = ast[0][1];
                        var fun_ident = ast[0][0];
                        
                        if (patterns.length == 0) {
                            return new haskell.ast.Variable(
							    new haskell.ast.VariableBinding(fun_ident),
							    ast[1]
                            );
                        }
                        
                        //var name = new haskell.ast.VariableBinding(fun_ident);
                        
                        var fun = ast[1];
                        
                        return new haskell.ast.Function(fun_ident, patterns, fun);
                    }
                } catch (e) {
                    console.log("%o", e);
                }
            });
        };
        
        // This choice sequence differs from the haskell specification
        // gendecl and funlhs had to be swapped in order for it to parse
        // but I have not been able to seen any side effects from this
        var decl = choice(  fun_action(sequence(ws(choice(funlhs, pat)), ws(rhs))),
                            gendecl
                         );
        
	// Redefinition, see "var decls"
        decls = action(sequence(expect(ws('{')), list(ws(decl), ws(';')), expect(ws('}'))), function(ast) { return ast; });
        
        var type_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var data_action = function(p) {
            return action(p, function(ast) {
                var ident = ast[1][0];
                var constructors = ast[2];
		// TODO: type variables
                return new haskell.ast.Data(ident, [], constructors);
            });
        };
        
        var newtype_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var class_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        }
        
        var instance_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var default_action = function(p) {
            return action(p, function(ast) {
                return ast;
            });
        };
        
        var topdecl = choice(   type_action(sequence(ws(qtycls), ws(simpletype), ws('='), ws(type))),
                                data_action(sequence(expect(ws("data")), optional(sequence(context, expect("=>"))), ws(simpletype), expect(ws('=')), constrs, optional(deriving))),
                                newtype_action(sequence(ws("newtype"), optional(sequence(context, "=>")), ws(simpletype), ws('='), newconstr, optional(deriving))),
                                class_action(sequence(expectws("class"), optional(sequence(scontext, expectws("=>"))), tycls, tyvar, optional(sequence(expectws("where"), cdecls)))),
                                instance_action(sequence(expectws("instance"), optional(sequence(scontext, "=>")), qtycls, inst, optional(sequence(expectws("where"), idecls)))),
                                default_action(sequence(expectws("default"), expectws('('), list(type, ','), expectws(')'))),
                                ws(decl)
                            );
        
        var topdecls_action = function(p) {
            return action(p, function(ast) {
                return ast.filter(function(element) {
                    return element instanceof haskell.ast.Declaration;
                });
            });
        };
        var topdecls = topdecls_action(list(ws(topdecl), ws(';')));
        
        var cname = choice(var_, con);
        
        var import_ = choice(   var_,
                                sequence(tycon, optional(choice(sequence(ws('('), ws(".."), ws(')')),
                                                            sequence(ws('('), list(cname, ','), ws(')'))))),
                                sequence(tycls, optional(choice(sequence(ws('('), ws(".."), ws(')')),
                                                            sequence(ws('('), list(var_, ','), ws(')')))))
                            );
        
        var impspec = choice(   sequence(ws('('), list(ws(import_), ws(',')), ws(')')),
                                sequence(ws("hiding"), ws('('), list(ws(import_), ws(',')), ws(')'))
                            );
        var impdecl = choice(sequence(ws("import"), optional(ws("qualified")), ws(modid), optional(sequence(ws("as"), ws(modid))), optional(ws(impspec))),
                            '');

        var export_ = choice(   qvar,
                                sequence(qtycon, optional(choice(sequence(ws('('), ws(".."), ws(')')),
                                                            sequence(ws('('), list(cname, ','), ws(')'))))),
                                sequence(qtycls, optional(choice(sequence(ws('('), ws(".."), ws(')')),
                                                            sequence(ws('('), list(qvar, ','), ws(')'))))),
                                sequence(ws("module"), modid)
                            );

        var exports = sequence(ws('('), list(ws(export_), ws(',')), ws(')'));

        var impdecls = list(ws(impdecl), ws(';'));

        
        var body_action = function(p) {
            return action(p, function(ast) {
                return ast[1];
            });
        };    

        var body = choice(  sequence(ws('{'), impdecls, ws(';'), topdecls, optional(ws(';')), ws('}')),
                            sequence(ws('{'), impdecls, optional(ws(';')), ws('}')),
                            body_action(sequence(ws('{'), topdecls, optional(ws(';')), ws('}')))
                        );

        var module_action = function(p) {
            return action(p, function(ast) {
                var declarations = null;
                
                if (ast instanceof Array) {
                    return new haskell.ast.Module(ast[4]);
                } else {
                    return new haskell.ast.Module(ast);
                }
            });
        }

        var module = module_action(choice(sequence(ws("module"), ws(modid), optional(exports), ws("where"), body),
                            body));
        
        var toplevel_exp = choice(sequence(expect(ws('{')), ws(exp), expect(ws('}'))), exp);
        toplevel_exp = action(toplevel_exp, function(ast) {
            return ast[0];
        });

        var toplevel_stmt = choice(sequence(expect(ws('{')), ws(stmt), expect(ws('}'))), stmt);
        toplevel_stmt = action(toplevel_stmt, function(ast) {
            return ast[0];
        });

        var program = action(sequence(choice(toplevel_stmt, module), ws(end_p)), function(ast) { return ast[0]; });
        
        // Pragma macro parser
        var pragmaId = join_action(repeat1(negate(choice('\t', ' ', '\r', '\n', "#-}"))), "");
        var pragma = action(sequence(expect(ws("{-#")), ws(pragmaId), expect(ws("#-}"))), 
                function(ast) {
                    var p = ast[0];
                    // Add extension alternatives here
                    if (p == "MagicHash") {
                        enableHash = true;
                    }
                    return "";
                });
                
        var grammar = action(sequence(program), function(ast) {
                return ast[ast.length - 1];
            });
        
        // comments grammar, allows nested multi line comments
        var singleLineComment = sequence(ws("--"), repeat0(negate(choice('\n', '\r'))));
        var multiLineComment = function(state) { return multiLineComment(state); };
        var multiLineComment = sequence(butnot(ws("{-"), ws("{-#")), repeat0(choice(multiLineComment, negate("-}"))), ws("-}"));
        
        var strip_comments_action = function(ast) {
            return "";
        };
        
        singleLineComment = action(singleLineComment, strip_comments_action);
        multiLineComment = action(multiLineComment, strip_comments_action);
        
        var comments = repeat0(choice(singleLineComment, multiLineComment, negate(choice(singleLineComment, multiLineComment))));
        comments = join_action(comments, "");
        
        // Step 1: Strip comments
        comments = join_action(sequence(repeat0(pragma), comments), "");
        
        var stripped = comments(ps(code)).ast;
        
        // Step 2: Parse lexical syntax and convert to context free
        var lexer_state = {
            indents: new Array(),
            current: 0
        }
         
        var whitestuff = choice('\t', ' ');
        var tab = action(repeat0(whitestuff), function(ast) {
            var cnt = 0;
            for (var i in ast) {
                if (i == '\t') {
                    cnt += 8;
                } else {
                    cnt += 1;
                }
            }
            
            lexer_state.current += cnt;
            
            lexer_state.indents.push({ depth: cnt, bracket: false });
            var o = new LexObject(cnt, cnt);
            o.isStartTab = true;
            return o;
        });
        
        var LexObject = function(lex, indent) {
            this.lex = lex;
            this.indent = indent;
        }
        
        var sym_lexer = sym;
        if (enableHash) {
            sym_lexer = butnot(sym, '#')
        }
        
        var lexeme = join_action(repeat1(negate(choice('\n', '\r', ' ', '\t', ';', '{', '}', '(', ')', '[', ']', ',', sym_lexer))), "");
        lexeme = choice(';', '{', '}', join_action(sequence('(', sym, ')'), ""), '(', ')', '[', ']', ',', sym, lexeme);
        lexeme = action(lexeme, function(ast) {
            var indent = lexer_state.current;
            lexer_state.current += ast.length;
            return new LexObject(ast, indent);
        });
        
        var ws_ = function(p) {
            return action(sequence(repeat0(choice(' ', '\t')), p), function(ast) {
                for (var i = 0; i < ast[0].length; i++) {
                    if (ast[0][i] == '\t')
                        lexer_state.current += 8;
                    else
                        lexer_state.current += 1;
                }
                lexer_state.current += ast[0].length;
                return ast[ast.length - 1]; 
            });
        }
        
        var concat_action = function(p) {
            return action(p, function(ast) {
                lexer_state.current = 1;
                var a = ast[1];
                /*for (var i in a) {
                    ast.push(a[i]);
                }*/
                if (a.length > 0) {
                    a[0].isFirst = true;
                }
                return a
            });
        }
        
        var line = concat_action(sequence(tab, repeat0(ws_(lexeme)), repeat0(choice(' ', '\t'))));
        var lines = action(list(line, '\n'), function(ast) {
            var a = Array();
            for (var i in ast) {
                var b = ast[i];
                for (var j in b) {
                    a.push(b[j]);
                }
            }
            return a;
        });
        
        var lexalized = lines(ps(stripped)).ast;
        
        var derivedIndentLevels = new Array();
        
        for (var i = 0; i < lexalized.length; i++) {
            var lex = lexalized[i].lex;
            
            if ((lex == "let" || lex == "where" || lex == "do" || lex == "of") && lexalized[i + 1].lex != '{') {
                var nextIndent = lexalized[i + 1].indent;
                
                if (lex == "let") {
                    nextIndent += 1;
                }
                
                var newLexo = new LexObject(nextIndent, nextIndent); // Insert {n} where n is indent level of next lexeme
                newLexo.isBracketsIndent = true;
                
                derivedIndentLevels.push(lexalized[i]);
                derivedIndentLevels.push(newLexo);
            } else if (i == 0 && lex != '{' && lex != "module") {
                var indent = lexalized[i].indent;
                
                var newLexo = new LexObject(indent, indent); // Insert {n} where n is indent level of first lexeme
                newLexo.isBracketsIndent = true;
                
                derivedIndentLevels.unshift(newLexo);
                derivedIndentLevels.push(lexalized[i]);
            } else if (i > 0 && lexalized[i].isFirst && lexalized[i].indent > 0 && !derivedIndentLevels[derivedIndentLevels.length - 1].isBracketsIndent) {
                var indent = lexalized[i].indent;
                
                var newLexo = new LexObject(indent, indent); // Insert <n< where n is indent level
                newLexo.isArrowsIndent = true;
                
                derivedIndentLevels.push(newLexo);
                derivedIndentLevels.push(lexalized[i]);
            } else {
                derivedIndentLevels.push(lexalized[i]);
            }
        }
        
        var layout_state = {
            let_stack: new Array()
        };
        
        var applyLayoutRules = function(ts, ms, out) {
            while (!(ts.length == 0 && ms.length == 0)) {
                if (ts.length == 0) {
                    var m = ms[0];
                    ms.shift();
                    
                    if (m != 0) {
                        out.push('}');
                    } else {
                        console.log("layout error");
                        break;
                    }
                } else {
                    var t = ts[0];
                    
                    if (t.lex == "let") {
                        layout_state.let_stack.push(t);
                    }
                    
                    if (t.isArrowsIndent) {
                        if (ms[0] == t.indent) {
                            ts.shift();
                            out.push(';');
                        } else if (t.indent < ms[0]) {
                            ms.shift();
                            out.push('}');
                        } else {
                            ts.shift();
                        }
                    } else if (t.isBracketsIndent) {
                        var n = t.indent;
                        
                        if (ms.length > 0 && n > ms[0]) {
                            var m = ms[0];
                            out.push('{');
                            ts.shift();
                            ms.unshift(n);
                        } else if (ms.length == 0 && n > 0) {
                            ts.shift();
                            out.push('{');
                            ms.push(n);
                        } else {
                            t.isBracketsIndent = false;
                            t.isArrowsIndent = true;
                            ms.shift();
                            out.push('{');
                            out.push('}');
                        }
                    } else if (t.lex == '}') {
                        var m = ms.shift();
                        if (m == 0) {
                            ts.shift();
                            out.push('}');
                        } else if(m != undefined) { // TODO: see if there is a way around this stupid shit
                                                    // or if it has any consequences.
                            out.push('}');
                        } else {
                            console.log("layout error");
                            break;
                        }
                    } else if (t.lex == '{') {
                        ts.shift();
                        ms.unshift(0);
                        out.push('{');
                    } else {
                        var m = ms[0];
                        if (m != 0 && m != undefined && t.lex == "in" && layout_state.let_stack.length > 0) { 
                            // parse-error(t) is more or less equals to checking for in
                            // or maybe not, but at least it expands let ... in correctly
                            // we also need to make sure that we are actually in a let expression
                            // so we keep track of all nested lets in a stack
                            layout_state.let_stack.pop();
                            out.push('}');
                            ms.shift();
                        } else {
                            ts.shift();
                            out.push(t.lex);
                        }
                    }
                }
            }
        }
        
        var layoutApplied = new Array();
        applyLayoutRules(derivedIndentLevels, new Array(), layoutApplied);
        
        // Step 3: Parse context free grammar
        var contextFree = layoutApplied.join(" ");
        console.log("%o", contextFree);
        var result = grammar(ps(contextFree));
        
        return result;
    };
})(haskell.parser, haskell.ast);
