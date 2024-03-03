let img;
let ditheredImg; // Off-screen graphics buffer for dithering
let resInput; // Updated to use input boxes
let canvas;

function setup() {
    canvas = createCanvas(600, 480);
    canvas.center('horizontal');
    background(220);

    const controlsDiv = createDiv('');
    controlsDiv.id('controls');
    controlsDiv.style('flex', 'justify-between', 'center');
    controlsDiv.position(canvas.x, windowHeight - 180);

    createLabelAndInput(controlsDiv, 'Resolution (1-150):', 5, () => {
        if (img && ditheredImg) ellipseDitherImage();
    });

    input = createFileInput(handleFile);
    input.parent(controlsDiv);

    button = createButton('Download');
    button.parent(controlsDiv);
    button.mousePressed(downloadImage);

    noLoop();
}

function draw() {
    // Now only redraws when explicitly called
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            ditheredImg = createGraphics(img.width, img.height);
            ellipseDitherImage();
        });
    }
}

function createLabelAndInput(parentDiv, labelText, defaultValue, inputCallback) {
    let label = createElement('label', labelText);
    label.parent(parentDiv);

    let input = createInput(defaultValue.toString(), 'number');
    input.parent(parentDiv);
    input.input(inputCallback);

    // Assign the input to the appropriate global variable
    if (labelText.startsWith('Resolution')) {
        resInput = input; // Make sure this is declared globally
    }
}

function ellipseDitherImage() {
    if (!img || !ditheredImg) return; // Ensure the image is loaded
    ditheredImg.background(0);
    //ditheredImg.background(random(255), random(255), random(255));
    let resolution = parseInt(resInput.value());
    img.loadPixels();

    for (let y = 0; y < img.height; y += resolution) {
        for (let x = 0; x < img.width; x += resolution) {
            let gray = 0;
            let count = 0;

            for (let ny = y; ny < y + resolution && ny < img.height; ny++) {
                for (let nx = x; nx < x + resolution && nx < img.width; nx++) {
                    let nindex = (nx + ny * img.width) * 4;
                    gray += (img.pixels[nindex] + img.pixels[nindex + 1] + img.pixels[nindex + 2]) / 3;
                    count++;
                }
            }
            gray /= count;

            // Determine the size of the ellipse based on gray value
            let size = map(gray, 0, 255, resolution, 0);

            // ditheredImg.fill(gray);
            // ditheredImg.noStroke();

            ditheredImg.stroke(255);
            ditheredImg.strokeWeight(0.1 * gray / 20);
            ditheredImg.noFill();
            if (gray > 128) {
                ditheredImg.noStroke();
                ditheredImg.strokeWeight(0.02);
                ditheredImg.fill(gray * 2, gray * 3, gray * 4);
                //ditheredImg.fill(0);
                ditheredImg.rect(x + resolution / 2, y + resolution / 2, size, size);
            }
            if (gray < 20) {
                ditheredImg.stroke(255);
                ditheredImg.strokeWeight(0.01);
                //ditheredImg.noStroke();
                //ditheredImg.stroke(random(255), gray / 2, gray * 2);
                ditheredImg.noFill();
                //ditheredImg.fill(50, random(100), 244);
                //ditheredImg.ellipse(random(width * 4), random(height * 4), random(height * 4), random(width * 4));
                ditheredImg.line(random(width * 4), random(height * 4), random(width * 4), random(height * 4));
            }
            if (gray > 120) {
                ditheredImg.noStroke();
                ditheredImg.fill(255);
                //ditheredImg.stroke(random(255), 50, 250);
                ditheredImg.line(x + resolution / 2, y + resolution / 2, size, size);
            }
            ditheredImg.noStroke();
            //ditheredImg.rotate(PI / 4);
            ditheredImg.fill(random(255), random(255), random(255));
            ditheredImg.ellipse(x + resolution / 2, y + resolution / 2, size, size);


            // ditheredImg.stroke(gray);
            // ditheredImg.strokeWeight(0.1);
            // ditheredImg.noFill();

            //ditheredImg.ellipse(random(width * 4), random(height * 4), random(width * 4), random(height * 4));

            //ditheredImg.translate(ditheredImg.mouseX, ditheredImg.mouseY);
        }
    }

    // After applying the dithering effect, display the scaled version on the main canvas
    image(ditheredImg, 0, 0, width, height);
}


function downloadImage() {
    // Save the off-screen buffer, preserving the original image dimensions and dithering effect
    save(ditheredImg, 'dithered_image.png');
}