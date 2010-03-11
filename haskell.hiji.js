(function($){
    var evaluateHaskell = function(line, env)
    {
	ast = haskell.parser.parse(line).ast;
	console.log("%o", ast);
        return haskell.interpreter.eval(ast, env);
    };
    var makeModules = function(modules){
        return "<ul class='modules'><li>" + modules.join("</li><li>") + "</li></ul>";
    };
    var makeEntered = function(modules, entered){
        return $("<li class='entered'>" + makeModules(modules) + "<span class='line'>" + entered + "</span></li>");
    };
    var makeResponse = function(response){

    };
    var makeInput = function(modules){
        return "<li class='input'>" + makeModules(modules) + "<input type='text' name='inputBox'></li>";
    };
    var makeOutput = function(output) {
	console.log("%o", output);
        return $("<li class='output'></li>").text(output.toString());
    };

    $.fn.startHiji = function() {
        var modules = new Array();
        var hist = new Array();
        
        // history
        var hiss = new historry;
            // load history from cookie
            hiss_cookie = $.cookie("hiss");
            if(hiss_cookie != null)
                hiss.history_array = hiss_cookie.split(",");

	var env = new haskell.interpreter.RootEnv();
	haskell.interpreter.primitives(env);
        
        modules[0] = "Prelude";
        modules[1] = "Control.Monad";
        this.html("<ol>" + makeInput(modules) + "</ol>");

        $("input:text:visible:first").focus();
        
        this.keydown(function(e){
            var input = $('input', this);
            var line = input.attr("value");
            if(e.keyCode=='38'){
                input.attr("value", hiss.older());
            }
            if(e.keyCode=='40'){
                input.attr("value", hiss.newer());
            }
            if (e.keyCode=='13'){
                input.attr("value","");
                var newLine = makeEntered(modules, line);
                var output = makeOutput(evaluateHaskell(line, env));
                $('.input', this).after(output).replaceWith(newLine);
                $("ol",this).append(makeInput(modules));
                 
                //set focus
                $("input:text:visible:first").focus();

                hiss.addHistory(line);

                // save history to cookie
                $.cookie("hiss", hiss.history_array.toString(), {expires: 3 });              

            }
        });
    };
})(jQuery);


// historry-class with nice name
// !!!WARNING!!! NICE NAME
historry = function (){
    this.pointer = 0;
    this.history_array = new Array();
    this.addHistory = function(input){
        this.history_array.unshift(input);
        this.pointer = -1;
    };

    this.older = function(){
        this.pointer++;
        if(this.pointer >= this.history_array.length){
            this.pointer = this.history_array.length-1
        }
        return this.history_array[this.pointer];
    };

    this.newer = function(){
        this.pointer--;
        if(this.pointer < 0){
            this.pointer = -1
            return "";
        }
        return this.history_array[this.pointer];
    };

};
